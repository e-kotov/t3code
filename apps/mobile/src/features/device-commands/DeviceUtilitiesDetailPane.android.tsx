import { View } from "react-native";
import { AppBar } from "../../components/ui/AppBar";
import { EmptyState } from "../../components/ui/EmptyState";
import { NativeStackScreenOptions } from "../../native/StackHeader";

export function DeviceUtilitiesDetailPane() {
  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <AppBar embedded title="Utilities" />
      <View className="flex-1 items-center justify-center px-10">
        <EmptyState
          title="Device utilities"
          detail="Inspect services or run commands in the sidebar."
          variant="plain"
        />
      </View>
    </>
  );
}
