import {
  type ConnectionTransientError,
  ForkCredentialCatalog,
  ForkDirectSessionRenewal,
} from "@t3tools/client-runtime/connection";
import * as Context from "effect/Context";
import { fetch as expoFetch } from "expo/fetch";

// React Native's global fetch runs on XMLHttpRequest and follows redirects whatever
// `redirect` says. Expo's native fetch fails on one, so the token never reaches its target.
const renewalFetch: typeof globalThis.fetch = (url, options) =>
  expoFetch(url, { ...options, redirect: "error" });

/** Fork: what direct-session renewal needs from this app's catalog and network. */
export const renewalServices =
  (catalog: ForkCredentialCatalog.CatalogStore<ConnectionTransientError>) =>
  <Services>(context: Context.Context<Services>) =>
    context.pipe(
      Context.add(
        ForkCredentialCatalog.ForkCredentialSwap,
        ForkCredentialCatalog.makeCredentialSwap(catalog),
      ),
      Context.add(ForkDirectSessionRenewal.ForkRenewalFetch, renewalFetch),
    );
