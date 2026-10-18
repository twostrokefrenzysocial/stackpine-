// App entry. Imports run in order: the background task is defined at module
// scope (so it can run headless), then Expo Router boots the UI. The widget
// handler (Android only) registers with AppRegistry right after.
import './src/platform/backgroundTask';
import 'expo-router/entry';
import { Platform } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/platform/widget';

if (Platform.OS === 'android') registerWidgetTaskHandler(widgetTaskHandler);
