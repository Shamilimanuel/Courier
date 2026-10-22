import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useTheme } from "../theme/ThemeContext";
import { IconButton, ClayButton } from "./Clay";
import { BackIcon } from "./icons";

/** Full-screen QR scanner for reading the pairing code shown by the agent. */
export default function QRScanner({ visible, onClose, onScanned }) {
  const { theme } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (visible) setLocked(false);
  }, [visible]);

  function handleBarcode({ data }) {
    if (locked) return;
    setLocked(true);
    onScanned(data);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: "#000" }]}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleBarcode}
          />
        ) : (
          <View style={styles.permissionWrap}>
            <Text style={styles.permissionText}>
              Courier needs the camera to read the pairing code shown on your
              PC.
            </Text>
            <ClayButton label="Allow camera access" tone="accent" onPress={requestPermission} />
          </View>
        )}

        {permission?.granted && (
          <>
            <View style={styles.frame} pointerEvents="none" />
            <Text style={styles.caption}>Point your camera at the QR code on your PC</Text>
          </>
        )}

        <View style={styles.backRow}>
          <IconButton accessibilityLabel="Cancel" onPress={onClose}>
            <BackIcon size={17} color={theme.ink} strokeWidth={2.2} />
          </IconButton>
        </View>

        <Pressable style={styles.manualRow} onPress={onClose} hitSlop={10}>
          <Text style={styles.manualText}>Can't scan it? Enter the details by hand</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const FRAME_SIZE = 240;

const styles = StyleSheet.create({
  container: { flex: 1 },
  backRow: { position: "absolute", top: 56, left: 24 },
  frame: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    marginLeft: -FRAME_SIZE / 2,
    marginTop: -FRAME_SIZE / 2 - 30,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.85)",
    borderRadius: 20,
  },
  caption: {
    position: "absolute",
    bottom: 90,
    left: 24,
    right: 24,
    textAlign: "center",
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  permissionWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 20,
  },
  permissionText: { color: "#fff", fontSize: 14, textAlign: "center", lineHeight: 20 },

  manualRow: {
    position: "absolute",
    bottom: 40,
    left: 24,
    right: 24,
    alignItems: "center",
    paddingVertical: 10,
  },
  manualText: { color: "rgba(255,255,255,0.65)", fontSize: 13.5, fontWeight: "600" },
});
