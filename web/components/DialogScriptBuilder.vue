<template>
  <v-card variant="outlined" class="pa-4">
    <v-card-title class="text-subtitle-1 px-0 pt-0">Create dialog script</v-card-title>
    <p class="text-body-2 text-medium-emphasis mb-4">
      A script is the message script two accounts follow — like a short chat. You will attach it to a
      <strong>session</strong> later (who is Sender A and who replies).
    </p>

    <v-text-field
      v-model="name"
      label="Script name"
      placeholder="e.g. Warm-up chat #1"
      variant="outlined"
      density="comfortable"
      class="mb-4"
    />

    <p class="text-subtitle-2 mb-2">How should messages be chosen?</p>
    <v-radio-group v-model="mode" hide-details class="mb-4">
      <v-radio value="turns">
        <template #label>
          <div>
            <span class="font-weight-medium">Write each line myself</span>
            <div class="text-caption text-medium-emphasis">
              Type messages or pick templates per line; optional wait for a specific peer reply.
            </div>
          </div>
        </template>
      </v-radio>
      <v-radio value="template_pairs">
        <template #label>
          <div>
            <span class="font-weight-medium">Use message templates</span>
            <div class="text-caption text-medium-emphasis">
              Alternating question + answer templates with spintax (same as campaigns).
            </div>
          </div>
        </template>
      </v-radio>
    </v-radio-group>

    <!-- Manual lines -->
    <div v-if="mode === 'turns'" class="mb-4">
      <v-alert type="info" variant="tonal" density="compact" class="mb-3">
        <strong>Sender A</strong> is the first account you pick in a session.
        <strong>Sender B</strong> is the other sender (or “read only” for a contact peer).
        Lines run top to bottom. Pauses are randomized slightly (about ±15%).
        Set <strong>Wait for reply</strong> on a line to block the next step until the peer sends that
        exact message (works for real users not controlled by this app).
      </v-alert>

      <div v-for="(turn, idx) in turns" :key="idx" class="turn-row mb-3 pa-3 rounded border">
        <div class="d-flex align-center gap-2 mb-2">
          <v-chip size="small" color="primary" variant="flat">Line {{ idx + 1 }}</v-chip>
          <v-spacer />
          <v-btn
            v-if="turns.length > 1"
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            :aria-label="`Remove line ${idx + 1}`"
            @click="removeTurn(idx)"
          />
        </div>
        <v-row dense>
          <v-col cols="12" md="4">
            <v-select
              v-model="turn.side"
              :items="sideOptions"
              label="Who sends this?"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="3">
            <v-text-field
              v-model.number="turn.pauseSec"
              type="number"
              label="Pause after (sec)"
              variant="outlined"
              density="compact"
              hide-details
              min="5"
              max="600"
              hint="±15% jitter"
            />
          </v-col>
          <v-col cols="12" md="5">
            <v-select
              v-model="turn.contentMode"
              :items="contentModeOptions"
              label="Message source"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col v-if="turn.contentMode === 'template'" cols="12">
            <v-select
              v-model="turn.templateId"
              :items="templates"
              item-title="name"
              item-value="_id"
              label="Template"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col v-else cols="12">
            <v-textarea
              v-model="turn.text"
              label="Message text"
              variant="outlined"
              density="compact"
              rows="2"
              auto-grow
              :placeholder="turn.side === 'a' ? 'Hi, are you there?' : 'Yes, all good!'"
            />
          </v-col>
          <v-col v-if="idx > 0" cols="12">
            <v-text-field
              v-model="turn.waitForText"
              label="Wait for peer reply (exact text)"
              placeholder="e.g. Yes, I'm here"
              variant="outlined"
              density="compact"
              hide-details
              clearable
            />
          </v-col>
        </v-row>
      </div>

      <v-btn variant="tonal" prepend-icon="mdi-plus" class="mb-3" @click="addTurn">Add another line</v-btn>

      <v-btn size="small" variant="text" class="mb-2" @click="fillExample">Fill example conversation</v-btn>

      <v-card v-if="previewLines.length" variant="tonal" class="pa-3 mb-2">
        <div class="text-caption text-medium-emphasis mb-2">Preview</div>
        <div v-for="(line, i) in previewLines" :key="i" class="text-body-2 mb-1">
          <v-chip size="x-small" class="mr-2">{{ line.who }}</v-chip>
          {{ line.text || '…' }}
          <span v-if="line.wait" class="text-caption text-warning"> · wait: «{{ line.wait }}»</span>
          <span class="text-caption text-medium-emphasis"> · pause {{ line.pauseMin }}–{{ line.pauseMax }}s</span>
        </div>
      </v-card>
    </div>

    <!-- Templates -->
    <div v-else class="mb-4">
      <v-alert type="info" variant="tonal" density="compact" class="mb-3">
        Each <strong>round</strong> sends one question (Sender A) then one answer (Sender B). Templates
        support spintax like <code>{Hi|Hello} {firstName}</code>.
        <NuxtLink to="/templates" class="text-primary">Manage templates</NuxtLink>
      </v-alert>
      <v-row dense>
        <v-col cols="12" md="6">
          <v-select
            v-model="questionTemplateId"
            :items="templates"
            item-title="name"
            item-value="_id"
            label="Question (Sender A)"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            v-model="answerTemplateId"
            :items="templates"
            item-title="name"
            item-value="_id"
            label="Answer (Sender B)"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12">
          <v-text-field
            v-model="peerWaitText"
            label="Wait for contact reply (exact text, between rounds)"
            placeholder="Text the real contact must send before the next question"
            variant="outlined"
            density="comfortable"
            clearable
          />
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field
            v-model.number="rounds"
            type="number"
            min="1"
            max="50"
            label="How many Q→A rounds?"
            variant="outlined"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field
            v-model.number="defaultPauseSec"
            type="number"
            min="5"
            max="600"
            label="Pause between steps (sec)"
            hint="±15% jitter"
            variant="outlined"
            density="comfortable"
            persistent-hint
          />
        </v-col>
      </v-row>
      <p class="text-caption text-medium-emphasis">
        Total steps: {{ rounds * 2 }} ({{ rounds }} question{{ rounds === 1 ? '' : 's' }} +
        {{ rounds }} answer{{ rounds === 1 ? '' : 's' }})
      </p>
    </div>

    <v-row dense class="mb-4">
      <v-col cols="12" md="4">
        <v-text-field
          v-model.number="typingSec"
          type="number"
          min="0"
          max="30"
          label="Typing indicator (sec)"
          hint="Shows “typing…” before each send"
          variant="outlined"
          density="comfortable"
          persistent-hint
        />
      </v-col>
      <v-col v-if="mode === 'turns'" cols="12" md="4">
        <v-text-field
          v-model.number="defaultPauseSec"
          type="number"
          min="5"
          max="600"
          label="Default pause for new lines"
          variant="outlined"
          density="comfortable"
        />
      </v-col>
    </v-row>

    <v-btn color="primary" size="large" :loading="saving" :disabled="saving" @click="submit">
      Save script
    </v-btn>

    <v-expansion-panels class="mt-4" variant="accordion">
      <v-expansion-panel title="Advanced: import from CSV / JSON file">
        <v-expansion-panel-text>
          <p class="text-caption text-medium-emphasis mb-2">
            Columns: <code>side</code> (a or b), <code>text</code> or <code>templateId</code>, optional
            <code>waitForText</code>, <code>delaySecMin</code>, <code>delaySecMax</code>. Uses the script name above.
          </p>
          <slot name="import" />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </v-card>
</template>

<script setup lang="ts">
import { previewTemplate } from '~/utils/spintax';

export interface DraftTurn {
  side: 'a' | 'b';
  contentMode: 'text' | 'template';
  text: string;
  templateId: string;
  waitForText: string;
  pauseSec: number;
}

const props = defineProps<{
  templates: Array<{ _id: string; name: string; body?: string }>;
  saving?: boolean;
}>();

const emit = defineEmits<{
  save: [
    payload: {
      name: string;
      mode: 'turns' | 'template_pairs';
      turns?: Array<{
        side: 'a' | 'b';
        text?: string;
        templateId?: string;
        waitForText?: string;
        delaySecMin: number;
        delaySecMax: number;
      }>;
      questionTemplateId?: string;
      answerTemplateId?: string;
      peerWaitText?: string;
      rounds?: number;
      typingSec: number;
      defaultDelaySecMin: number;
      defaultDelaySecMax: number;
    },
  ];
}>();

function delayRangeFromPause(pauseSec: number): { min: number; max: number } {
  const base = Math.max(0, Math.floor(pauseSec));
  if (base === 0) return { min: 0, max: 0 };
  const spread = Math.max(3, Math.round(base * 0.15));
  return { min: Math.max(0, base - spread), max: base + spread };
}

const name = ref('');
const mode = ref<'turns' | 'template_pairs'>('turns');
const turns = ref<DraftTurn[]>([
  { side: 'a', contentMode: 'text', text: '', templateId: '', waitForText: '', pauseSec: 45 },
  { side: 'b', contentMode: 'text', text: '', templateId: '', waitForText: '', pauseSec: 45 },
]);
const questionTemplateId = ref('');
const answerTemplateId = ref('');
const peerWaitText = ref('');
const rounds = ref(2);
const typingSec = ref(3);
const defaultPauseSec = ref(45);

const sideOptions = [
  { title: 'Sender A', value: 'a' },
  { title: 'Sender B (other account)', value: 'b' },
];

const contentModeOptions = [
  { title: 'Type message', value: 'text' },
  { title: 'Use template', value: 'template' },
];

function turnPreviewText(turn: DraftTurn): string {
  if (turn.contentMode === 'template' && turn.templateId) {
    const t = props.templates.find((x) => x._id === turn.templateId);
    if (t?.body) return previewTemplate(t.body, { name: 'Alex', firstName: 'Alex' });
    return t?.name ? `[${t.name}]` : '';
  }
  return turn.text.trim();
}

const previewLines = computed(() =>
  turns.value.map((t, idx) => {
    const dr = delayRangeFromPause(t.pauseSec);
    return {
      who: t.side === 'a' ? 'A' : 'B',
      text: turnPreviewText(t),
      wait: idx > 0 ? t.waitForText.trim() : '',
      pauseMin: dr.min,
      pauseMax: dr.max,
    };
  }),
);

function addTurn(): void {
  const last = turns.value[turns.value.length - 1];
  const nextSide: 'a' | 'b' = last?.side === 'a' ? 'b' : 'a';
  turns.value.push({
    side: nextSide,
    contentMode: 'text',
    text: '',
    templateId: '',
    waitForText: '',
    pauseSec: defaultPauseSec.value,
  });
}

function removeTurn(idx: number): void {
  turns.value.splice(idx, 1);
}

function fillExample(): void {
  name.value = name.value || 'Example warm-up';
  turns.value = [
    { side: 'a', contentMode: 'text', text: 'Hey, how are you?', templateId: '', waitForText: '', pauseSec: 40 },
    {
      side: 'b',
      contentMode: 'text',
      text: '',
      templateId: '',
      waitForText: 'All good, thanks! And you?',
      pauseSec: 50,
    },
    {
      side: 'a',
      contentMode: 'text',
      text: 'Doing fine. Talk later?',
      templateId: '',
      waitForText: '',
      pauseSec: 60,
    },
    { side: 'b', contentMode: 'text', text: '', templateId: '', waitForText: 'Sure, see you!', pauseSec: 30 },
  ];
}

const toast = useToast();

function submit(): void {
  const trimmedName = name.value.trim();
  if (!trimmedName) {
    toast.warning('Enter a script name.');
    return;
  }

  const defaultDr = delayRangeFromPause(defaultPauseSec.value);

  if (mode.value === 'template_pairs') {
    if (!questionTemplateId.value || !answerTemplateId.value) {
      toast.warning('Pick both question and answer templates.');
      return;
    }
    emit('save', {
      name: trimmedName,
      mode: 'template_pairs',
      questionTemplateId: questionTemplateId.value,
      answerTemplateId: answerTemplateId.value,
      peerWaitText: peerWaitText.value.trim(),
      rounds: Math.max(1, rounds.value),
      typingSec: typingSec.value,
      defaultDelaySecMin: defaultDr.min,
      defaultDelaySecMax: defaultDr.max,
    });
    return;
  }

  const filled = turns.value.filter(
    (t) => (t.contentMode === 'text' && t.text.trim()) || (t.contentMode === 'template' && t.templateId),
  );
  if (!filled.length) {
    toast.warning('Add at least one line with text or a template.');
    return;
  }

  emit('save', {
    name: trimmedName,
    mode: 'turns',
    turns: filled.map((t, idx) => {
      const dr = delayRangeFromPause(t.pauseSec);
      return {
        side: t.side,
        ...(t.contentMode === 'template' ? { templateId: t.templateId } : { text: t.text.trim() }),
        ...(idx > 0 && t.waitForText.trim() ? { waitForText: t.waitForText.trim() } : {}),
        delaySecMin: dr.min,
        delaySecMax: dr.max,
      };
    }),
    typingSec: typingSec.value,
    defaultDelaySecMin: defaultDr.min,
    defaultDelaySecMax: defaultDr.max,
  });
}

function resetForm(): void {
  name.value = '';
  mode.value = 'turns';
  turns.value = [
    { side: 'a', contentMode: 'text', text: '', templateId: '', waitForText: '', pauseSec: defaultPauseSec.value },
    { side: 'b', contentMode: 'text', text: '', templateId: '', waitForText: '', pauseSec: defaultPauseSec.value },
  ];
  questionTemplateId.value = '';
  answerTemplateId.value = '';
  peerWaitText.value = '';
  rounds.value = 2;
}

function getName(): string {
  return name.value;
}

defineExpose({ resetForm, getName });
</script>

<style scoped>
.turn-row {
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
