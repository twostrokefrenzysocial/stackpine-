import { FlexWidget, ImageWidget, TextWidget, type WidgetTaskHandlerProps } from 'react-native-android-widget';

/**
 * Home-screen widget: the brain mark, status, and a red mic that opens
 * straight into voice mode (optimus://voice). Tapping anywhere else opens
 * the app.
 */
export function OptimusWidget() {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'optimus://' }}
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: '#0B0B0C', borderRadius: 8, padding: 14, flexDirection: 'row', alignItems: 'center', flexGap: 12 }}
    >
      <ImageWidget image={require('../../assets/brand/splash-emblem.png')} imageWidth={84} imageHeight={84} />
      <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 8 }}>
        <TextWidget text="OPTIMUS" style={{ fontSize: 15, color: '#F5F5F7', letterSpacing: 0.2, fontWeight: '600' }} />
        <TextWidget text="STATUS: READY" style={{ fontSize: 11, color: '#A1A1A6', fontFamily: 'monospace' }} />
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: 'optimus://voice' }}
          style={{ height: 52, width: 'match_parent', backgroundColor: '#E31B23', borderRadius: 4, justifyContent: 'center', alignItems: 'center' }}
          accessibilityLabel="Talk to Optimus"
        >
          <TextWidget text="TALK" style={{ fontSize: 15, color: '#FFFFFF', letterSpacing: 0.18, fontWeight: '600' }} />
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
