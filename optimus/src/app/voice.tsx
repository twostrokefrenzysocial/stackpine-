import { Redirect } from 'expo-router';

/** optimus://voice — used by the home-screen widget and the "Voice" shortcut. */
export default function VoiceEntry() {
  return <Redirect href="/chat/new?voice=1" />;
}
