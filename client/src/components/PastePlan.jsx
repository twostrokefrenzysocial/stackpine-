import { api } from '../lib/api.js';
import { Card } from './ui.jsx';
import PasteBox from './PasteBox.jsx';

/**
 * The free path to a generated week: copy the prompt, paste it into whichever
 * assistant you already pay for, paste the reply back. No API key, no metered
 * calls.
 */
export default function PastePlan({ weekStart, onSaved }) {
  return (
    <Card title="Build it with ChatGPT">
      <PasteBox
        steps={[
          'Copy the prompt.',
          'Paste it into ChatGPT and send.',
          'Copy its whole reply and paste it below.',
        ]}
        loadPrompt={async () => (await api.mealPrompt(weekStart)).prompt}
        placeholder='{ "week_start": ... }'
        submitLabel="Save this week"
        onSubmit={async (text) => {
          const res = await api.importMeals(weekStart, text);
          await onSaved(res.plan, 'pasted');
        }}
      />
    </Card>
  );
}
