import { FlexWidget, ImageWidget, TextWidget, type WidgetTaskHandlerProps } from 'react-native-android-widget';

/**
 * Home-screen widget: the brain mark, status, and a black Talk pill that opens
 * straight into voice mode (optimus://voice). Tapping anywhere else opens
 * the app.
 */
export function OptimusWidget() {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'optimus://' }}
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 14, flexDirection: 'row', alignItems: 'center', flexGap: 12 }}
    >
      <ImageWidget image={require('../../assets/brand/splash-emblem.png')} imageWidth={84} imageHeight={84} />
      <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 8 }}>
        <TextWidget text="OPTIMUS" style={{ fontSize: 15, color: '#16181D', letterSpacing: 0.4, fontWeight: '300' }} />
        <TextWidget text="READY" style={{ fontSize: 11, color: '#8D8F96', letterSpacing: 0.2, fontWeight: '500' }} />
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: 'optimus://voice' }}
          style={{ height: 52, width: 'match_parent', backgroundColor: '#16181D', borderRadius: 26, justifyContent: 'center', alignItems: 'center' }}
          accessibilityLabel="Talk to Optimus"
        >
          <TextWidget text="TALK" style={{ fontSize: 15, color: '#FFFFFF', letterSpacing: 0.18, fontWeight: '500' }} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(<OptimusWidget />);
      break;
    default:
      break;
  }
}
