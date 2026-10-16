// @effect-diagnostics nodeBuiltinImport:off -- Device-local configuration and subprocess boundary, never a remote environment.
// @effect-diagnostics globalTimers:off -- One Electron-main scheduler owns every renderer's leases.
import {
  decodeUtilityConfig,
  UTILITY_CONFIG_LIMIT,
  UTILITY_CONFIG_PATH,
  type UtilityExecution,
  type UtilityService,
  type UtilitySnapshot,
} from "@t3tools/contracts";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { UtilityProcessRunner } from "./UtilityProcessRunner.ts";

type ProcessRun = ReturnType<UtilityProcessRunner["start"]>;
export class DeviceUtilitiesRuntime {
  private state: UtilitySnapshot;
  private initialized: Promise<void> | undefined;
  private readonly clients = new Map<string, number>();
  private readonly observations = new Map<string, UtilityExecution>();
  private readonly actions = new Map<string, UtilityExecution>();
  private readonly running = new Map<string, ProcessRun>();
  private readonly actionProcesses = new Map<string, ProcessRun>();
  private readonly generations = new Map<string, number>();
  private readonly actionLocks = new Set<string>();
  private reloading = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly runner: UtilityProcessRunner;
  private readonly now: () => number;
  constructor(home: string, runner = new UtilityProcessRunner(), now: () => number = Date.now) {
    this.runner = runner;
    this.now = now;
    this.state = {
      config: null,
      configPath: NodePath.join(home, UTILITY_CONFIG_PATH),
      revision: 0,
      error: null,
      checks: [],
      actions: [],
    };
  }
  async snapshot() {
    this.initialized ??= this.load();
    await this.initialized;
    return {
      ...this.state,
      checks: [...this.observations.values()],
      actions: [...this.actions.values()],
    };
  }
  async reload() {
    await this.snapshot();
    if (this.actionLocks.size || this.actionProcesses.size || this.reloading)
      throw new Error("Wait for the current utility action to finish before reloading.");
    this.reloading = true;
    try {
      await this.load();
    } finally {
      this.reloading = false;
    }
    return this.snapshot();
  }
  private async load() {
    for (const run of this.running.values()) run.stop();
    this.running.clear();
    this.observations.clear();
    this.actions.clear();
    this.generations.clear();
    this.state = { ...this.state, revision: this.state.revision + 1, error: null, config: null };
    try {
      const info = await NodeFSP.stat(this.state.configPath);
      if (info.size > UTILITY_CONFIG_LIMIT)
        throw new Error("Utility configuration exceeds 64 KiB.");
      const config = decodeUtilityConfig(await NodeFSP.readFile(this.state.configPath, "utf8"));
      this.state = { ...this.state, config };
    } catch (cause) {
      this.state = { ...this.state, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }
  async active(clientId: string, active: boolean) {
    await this.snapshot();
    if (active) this.clients.set(clientId, this.now() + 75_000);
    else this.clients.delete(clientId);
    this.timer ??= setInterval(() => this.tick(), 1000);
    this.tick();
  }
  private tick() {
    const now = this.now();
    for (const [id, until] of this.clients) if (until <= now) this.clients.delete(id);
    if (!this.clients.size || this.state.error) return;
    for (const service of this.state.config?.services ?? []) {
      const last = this.observations.get(service.id);
      if (
        !last ||
        (service.intervalSeconds > 0 && now - last.startedAt >= service.intervalSeconds * 1000)
      )
        this.startCheck(service);
    }
  }
  async check() {
    await this.snapshot();
    if (this.state.error) return;
    for (const service of this.state.config?.services ?? []) this.startCheck(service);
  }
  private startCheck(service: UtilityService, force = false) {
    if (
      !service.enabled ||
      this.running.has(service.id) ||
      this.actionProcesses.has(service.id) ||
      this.actionLocks.has(service.id)
    )
      return;
    const previous = this.observations.get(service.id);
    if (!force && previous && this.now() - previous.startedAt < 10_000) return;
    const revision = this.state.revision;
    const generation = this.generations.get(service.id) ?? 0;
    const processRun = this.runner.start({
      serviceId: service.id,
      actionId: null,
      revision,
      command: service.check,
      timeoutSeconds: service.timeoutSeconds,
    });
    this.running.set(service.id, processRun);
    void processRun.promise.then((result) => {
      if (this.running.get(service.id) !== processRun) return;
      this.running.delete(service.id);
      if (
        this.state.revision === revision &&
        (this.generations.get(service.id) ?? 0) === generation
      )
        this.observations.set(service.id, result);
    });
  }
  async action(serviceId: string, actionId: string, revision: number) {
    await this.snapshot();
    if (revision !== this.state.revision || this.state.error || this.reloading)
      throw new Error("Configuration changed. Reopen the action before running it.");
    const service = this.state.config?.services.find((s) => s.id === serviceId && s.enabled);
    const action = service?.actions.find((a) => a.id === actionId);
    if (!service || !action) throw new Error("This utility action is unavailable.");
    if (this.actionProcesses.has(serviceId) || this.actionLocks.has(serviceId))
      throw new Error("An action is already running for this service.");
    this.actionLocks.add(serviceId);
    this.observations.delete(serviceId);
    this.generations.set(serviceId, (this.generations.get(serviceId) ?? 0) + 1);
    const check = this.running.get(serviceId);
    if (check) {
      check.stop();
      await check.promise;
      this.running.delete(serviceId);
    }
    const processRun = this.runner.start({
      serviceId,
      actionId,
      revision,
      command: action.command,
      timeoutSeconds: action.timeoutSeconds,
    });
    this.actionProcesses.set(serviceId, processRun);
    this.actionLocks.delete(serviceId);
    this.actions.set(serviceId, processRun.run);
    void processRun.promise.then((result) => {
      this.actions.set(serviceId, result);
      this.actionProcesses.delete(serviceId);
      if (this.state.revision === revision) this.startCheck(service, true);
    });
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    for (const run of [...this.running.values(), ...this.actionProcesses.values()])
      run.stop("App closed.");
    this.clients.clear();
  }
}
