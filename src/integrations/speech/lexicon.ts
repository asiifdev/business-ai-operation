/**
 * How English words in an Indonesian sentence should sound. The Indonesian voice reads every word with Indonesian
 * spelling rules, so "invoice" comes out wrong; writing it the way an Indonesian says it ("invois") fixes that without
 * touching the text people read. Only for speech, and only for the Indonesian voice. Add words as they come up.
 */
const SAY: Record<string, string> = {
  generate: 'generet',
  generative: 'generatif',
  image: 'imej',
  images: 'imej',
  agency: 'ejensi',
  digital: 'digital',
  design: 'disain',
  marketing: 'marketing',
  studio: 'studio',
  invoice: 'invois',
  invoices: 'invois',
  orbyte: 'orbait',
  deadline: 'dedlain',
  meeting: 'miting',
  email: 'imel',
  'e-mail': 'imel',
  dashboard: 'desbor',
  draft: 'draf',
  follow: 'folo',
  'follow-up': 'folo ap',
  update: 'apdet',
  upload: 'aplot',
  download: 'daunlot',
  link: 'link',
  online: 'onlain',
  offline: 'oflain',
  project: 'proyek',
  proposal: 'proposal',
  pipeline: 'paiplain',
  lead: 'lid',
  leads: 'lid',
  staff: 'staf',
  admin: 'admin',
  owner: 'ouner',
  website: 'websait',
  software: 'softwer',
  subscription: 'sabskripsyen',
  maintenance: 'meintenans',
  ticket: 'tiket',
  tiket: 'tiket',
  telegram: 'telegram',
  whatsapp: 'wotsap',
  voice: 'vois',
  note: 'nout',
  bug: 'bag',
  server: 'server',
  login: 'login',
  password: 'pasword',
  budget: 'bajet',
  caption: 'kapsyen',
  brief: 'brif',
  action: 'aksyen',
  center: 'senter',
  usd: 'dolar amerika',
};

const WORD = new RegExp(`\\b(${Object.keys(SAY).sort((a, b) => b.length - a.length).map((w) => w.replace(/[-]/g, '\\-')).join('|')})\\b`, 'gi');

/** Words typed in capitals are read as words, not spelled out letter by letter: "ASIIFDEV" becomes "asiifdev". */
const unshout = (text: string): string => text.replace(/\b[A-Z]{4,}\b/g, (word) => word.toLowerCase());

/** The text with English words respelled for the Indonesian voice. */
export const respellForSpeech = (text: string): string => unshout(text).replace(WORD, (word) => SAY[word.toLowerCase()] ?? word);
