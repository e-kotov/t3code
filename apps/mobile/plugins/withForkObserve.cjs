const { withSettingsGradle } = require("expo/config-plugins");

module.exports = function withForkObserve(config) {
  const projectId = config.extra?.eas?.projectId;
  if (typeof projectId === "string" && projectId.trim() !== "") return config;

  // Android calls OnCreate on every linked Expo module, including unused modules.
  return withSettingsGradle(config, (next) => {
    const anchor = "expoAutolinking.useExpoModules()";
    const contents = next.modResults.contents;
    if (contents.includes("// t3-fork-observe-exclusion")) return next;
    if (next.modResults.language !== "groovy" || !contents.includes(anchor)) {
      throw new Error("withForkObserve: Expo settings.gradle template changed.");
    }
    next.modResults.contents = contents.replace(
      anchor,
      "// t3-fork-observe-exclusion\n" +
        "expoAutolinking.exclude = ((expoAutolinking.exclude ?: []) + ['expo-observe']).unique()\n" +
        anchor,
    );
    return next;
  });
};
