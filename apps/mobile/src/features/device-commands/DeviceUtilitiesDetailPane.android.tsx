import { View } from "react-native";
import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { NativeStackScreenOptions } from "../../native/StackHeader";

export function DeviceUtilitiesDetailPane() {
  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <AndroidScreenHeader title="Utilities" />
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
