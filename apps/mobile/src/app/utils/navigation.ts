import { ActionSheetIOS, Alert, Linking } from 'react-native';

export function openNavigationMenu(
  latitude: number,
  longitude: number,
  name: string,
) {
  const options = ['ניווט עם Waze', 'ניווט עם Apple Maps', 'ביטול'];
  const cancelButtonIndex = 2;

  ActionSheetIOS.showActionSheetWithOptions(
    {
      options,
      cancelButtonIndex,
      title: 'בחר אפליקציית ניווט',
    },
    async (buttonIndex) => {
      if (buttonIndex === 0) {
        const wazeUrl = `waze://?ll=${latitude},${longitude}&navigate=yes`;
        const canOpen = await Linking.canOpenURL(wazeUrl);
        if (canOpen) {
          Linking.openURL(wazeUrl);
        } else {
          Alert.alert(
            'Waze לא מותקן',
            'אפליקציית Waze לא נמצאה במכשיר שלך.',
            [{ text: 'אישור' }],
          );
        }
      } else if (buttonIndex === 1) {
        const mapsUrl = `maps://?q=${encodeURIComponent(name)}&ll=${latitude},${longitude}`;
        Linking.openURL(mapsUrl);
      }
    },
  );
}
