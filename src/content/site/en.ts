import type { PageContent, PageSlug } from './types';

const updated = '2026-10-28';

/** English is the primary language (D-030). `{email}` and `{brand}` are replaced when rendering. */
export const en: Record<PageSlug, PageContent> = {
  '': {
    title: 'Orbyte: AI Business Operating System for Agencies',
    description: 'Orbyte keeps clients, invoices, leads and tasks in one system. AI finds problems and drafts the next step; a person approves anything risky.',
    h1: 'Run your agency with AI that asks before it acts',
    answer:
      '{brand} is an AI business operating system for agencies and software houses. It keeps clients, subscriptions, invoices, leads and tasks in one structured system. AI finds what needs attention and drafts the next step, and a person approves anything risky. Every action is recorded in an change history.',
    updated,
    home: {
      h1Accent: 'asks before it acts',
      howHeading: 'How it works',
      howIntro: 'Four steps from a business fact to an approved action. Select a step, then try the sample on the right.',
      stages: [
        { title: 'Your data stays the source of truth', body: 'Products, clients, subscriptions and invoices live as structured records. Amounts, dates and statuses are calculated by code, never guessed by AI.' },
        { title: 'Rules find what needs attention', body: 'Scheduled rules raise alerts: an invoice past its due date, a renewal coming up, a lead that went quiet. The same alert is never raised twice.' },
        { title: 'AI explains and drafts', body: 'For each alert, AI writes a plain-language explanation and a draft follow-up using the real numbers from your data. Nothing is sent to anyone.' },
        { title: 'A person approves, everything is recorded', body: 'Risky actions wait for approval in the web app or in Telegram. Approved actions run through the same code as the manual buttons, and the change history records who and what did it.' },
      ],
      ctaPrimary: 'Create your organization',
      ctaSecondary: 'See how it works',
      closing: 'Early access is open: create an organization and sign in today. The modules are being built in the open, and each one is marked with its real status.',
      note: 'Early access is free. Built with the Meta Model API.',
      controlsHeading: 'Designed so you stay in charge',
      controls: [
        { title: 'Approval before risk', body: 'AI drafts, a person decides. Risky actions always wait for approval.', status: 'in_development' },
        { title: 'A change history nobody can edit', body: 'Every change records who or what made it, and the record cannot be altered or deleted.', status: 'in_development' },
        { title: 'Your data, kept apart', body: 'Each organization is isolated in application code and again in the database.', status: 'available' },
        { title: 'AI never touches the money', body: 'Amounts, taxes and payment status come from code and recorded payments, not from AI.', status: 'in_development' },
      ],
    },
    faq: [
      { q: 'What is {brand}?', a: '{brand} is an AI business operating system for agencies and software houses: structured business data, AI that finds problems and drafts next steps, and human approval before risky actions.' },
      { q: 'Can I use it today?', a: 'Early access is open. You can create an organization and sign in now. The other capabilities are being built and the status of each is shown on this site.' },
    ],
  },
  product: {
    title: 'Orbyte Features: Billing, Action Center, Telegram',
    description: 'What Orbyte does for agencies: subscriptions and invoices, an AI Action Center with approval, meeting minutes, Telegram and marketing images.',
    h1: 'What Orbyte does',
    answer:
      '{brand} covers the recurring work of an agency: subscriptions and invoices, an Action Center where AI raises alerts and drafts next steps, meeting recordings turned into minutes, an interactive Telegram assistant and marketing images. Each capability below shows its real status today.',
    updated,
    sections: [
      {
        heading: 'What Orbyte does not do',
        bullets: [
          'It does not send messages or invoices to your clients automatically.',
          'It does not generate video or voice.',
          'It does not let AI change payments, invoice amounts or prices.',
          'It does not replace your accounting system or collect payments.',
        ],
      },
    ],
  },
  'product/action-center': {
    title: 'Action Center: AI Alerts With Human Approval',
    description: 'How the Orbyte Action Center turns business events into alerts, lets AI draft the next step, and waits for a person to approve.',
    h1: 'Action Center: AI alerts with human approval',
    answer:
      'The Action Center turns business events into alerts, such as an invoice past its due date. AI explains each alert using your real numbers and drafts a follow-up message, but never sends it. A person approves or rejects every risky action, in the web app or in Telegram.',
    updated,
    sections: [
      { heading: 'How an alert becomes an action', bullets: ['A scheduled rule notices a condition, such as an overdue invoice.', 'The alert is created once; running the rule again never duplicates it.', 'AI explains it and drafts a message using figures read from your data.', 'You approve, reject or edit. Approved actions run through the same code as the manual buttons.'] },
      { heading: 'What AI cannot do here', bullets: ['Record or change a payment.', 'Change an invoice amount, due date or a package price.', 'Delete data or change roles and settings.', 'Send anything outside the system.'] },
    ],
  },
  'product/billing': {
    title: 'Subscriptions and Invoices Without Surprises',
    description: 'Orbyte creates draft invoices before they are due, calculates totals in code, records payments as entries that cannot be edited and exports PDFs.',
    h1: 'Subscriptions and invoices without arithmetic surprises',
    answer:
      "{brand} stores each client's subscription and creates draft invoices before they are due. Totals, taxes, due dates and payment status are calculated by code, never by AI. Payments are recorded as entries that cannot be edited, and each invoice can be exported as a PDF that matches the screen exactly.",
    updated,
    sections: [
      { heading: 'What is calculated by code', bullets: ['Invoice totals and tax from line items.', 'Sequential invoice numbers without gaps.', 'Whether an invoice is overdue, derived from its due date rather than stored.', 'Paid status, derived from the recorded payments.'] },
      { heading: 'Not included', bullets: ['Online payment collection.', 'Automatic sending of invoices to clients: you download the PDF or copy the message.', 'Multi-currency and credit notes.'] },
    ],
  },
  'product/meetings': {
    title: 'Meeting Recordings to Minutes, Leads and Tasks',
    description: 'Upload a recording and Orbyte transcribes it, writes structured minutes and drafts leads and tasks for you to review. Indonesian and English.',
    h1: 'Meeting recordings to minutes, leads and tasks',
    answer:
      'Upload a meeting recording and {brand} transcribes it, writes structured minutes with decisions and action items, and drafts leads and tasks for you to review. Indonesian and English are supported, each file can be up to ten minutes, and nothing becomes a real task until you accept it.',
    updated,
    sections: [
      { heading: 'How it behaves', bullets: ['Longer recordings are split before transcription and joined in order.', 'Speaker labels are shown where the speech model provides them.', 'Prices in a draft proposal always come from your own package list, never from what was said aloud.', 'Instructions spoken in a recording are treated as content, never as commands.'] },
      { heading: 'Your recordings', bullets: ['Deleting a recording deletes its transcript too, in one action.', 'During early access, do not upload recordings that contain real client data.'] },
    ],
  },
  'product/telegram': {
    title: 'Interactive Telegram Assistant for Approvals',
    description: 'Approve or reject Orbyte alerts with buttons inside Telegram. Approvals use the same code as the web app and are recorded in the change history.',
    h1: 'An interactive Telegram assistant for approvals',
    answer:
      'Link your Telegram account to {brand} to receive alerts as cards with Approve, Reject and Details buttons. Approving in Telegram runs the same code as the web app, shows the result in the message, and is recorded in the change history. Your role limits what you can approve there too.',
    updated,
    sections: [
      { heading: 'Safety rules', bullets: ['A one-time pairing code links a chat to one user; unlinked chats receive no data.', 'Pressing Approve twice, or from the web and Telegram at once, executes only once.', 'Staff accounts cannot approve financial actions, in Telegram or anywhere else.'] },
    ],
  },
  'product/marketing-studio': {
    title: 'Marketing Studio: Images and Captions From Your Data',
    description: 'Create marketing images and captions from your own product data and brand kit. Prices come from your packages; generated images are labelled as AI-made.',
    h1: 'Marketing Studio: images and captions from your product data',
    answer:
      'Marketing Studio creates images and captions for launches, promotions and releases from your own product data and brand kit. Captions only state facts that exist in your data, prices come from your official packages, and generated images are labelled as AI-made. It does not generate video or voice.',
    updated,
    sections: [
      { heading: 'Limits', bullets: ['No video generation and no voice-over.', 'No invented testimonials, statistics or customer logos.', 'A daily limit on AI use applies to every organization.'] },
    ],
  },
  'how-it-works': {
    title: 'How Orbyte Works: From Data to Audit Trail',
    description: 'Orbyte keeps business facts as structured records, raises alerts with rules, lets AI draft next steps and records every approved action.',
    h1: 'How Orbyte works, from data to change history',
    answer:
      '{brand} keeps business facts as structured records. Scheduled rules raise alerts from those records, AI explains and drafts using real numbers, and a person approves risky actions. Approved actions run through the same code as manual buttons, and every step is written to an change history that cannot be edited.',
    updated,
    sections: [
      { heading: 'Why AI never changes money', paragraphs: ['Amounts, taxes, due dates and payment status come from code and recorded payments. AI reads these numbers and explains them; the tools it can call can draft, but they cannot record a payment or change an amount.'] },
      { heading: 'Why an alert is never raised twice', paragraphs: ['Every automatic effect carries a unique key. If a scheduled rule runs again for the same invoice and period, the second attempt does nothing.'] },
      { heading: 'Why content is treated as data', paragraphs: ['Text inside documents, transcripts and messages is treated as content, never as instructions. Risky actions cannot be triggered by that text, because they always wait for a person.'] },
    ],
  },
  security: {
    title: 'Security and AI Controls in Orbyte',
    description: 'How Orbyte separates organizations, limits AI, protects passwords and keeps an change history that cannot be edited. In place today versus still in development.',
    h1: 'Security and AI controls',
    answer:
      "Each organization's data is isolated in code and in the database, so one organization cannot read another's. AI can read and draft but cannot change payments, prices or invoice amounts, and risky actions need human approval. Passwords are stored as hashes, sign-in attempts are rate limited, and audit records cannot be edited or deleted.",
    updated,
    sections: [
      { heading: 'In place today', bullets: ['Organization isolation enforced in application code and by composite foreign keys in the database.', 'Passwords stored as hashes; sign-in attempts rate limited.', 'Deactivating a user ends all their sessions immediately.', 'An organization can never be left without an active Owner, enforced in the database.', 'The audit table rejects updates, deletes and truncation at the database level.'] },
      { heading: 'Designed and in development', bullets: ['Human approval for every risky AI-proposed action.', 'Daily AI spending limits per feature, with every model call recorded.', 'Cloudflare Turnstile and daily limits on new sign-ups.'] },
      { heading: 'What it is not', paragraphs: ['Orbyte has not had an independent security audit. If you find a vulnerability, please write to {email}.'] },
    ],
  },
  pricing: {
    title: 'Orbyte Pricing (Planned): Starter, Team, Business',
    description: 'Planned Orbyte plans: free Starter, Team at $15 and Business at $29 per user per month billed annually. Early access is free; billing is not live yet.',
    h1: 'Orbyte pricing (planned)',
    answer:
      'Orbyte plans to offer Starter (free), Team at $15 per user per month billed annually, Business at $29, and custom Enterprise. Platform billing is not live yet, so early-access organizations are not charged. Prices below are planned, were set against public competitor prices checked on 28 October 2026, and may change before billing starts.',
    updated,
    sections: [
      { heading: 'How these prices were chosen', bullets: ['Public price pages of Teamwork, Productive, Bonsai and Scoro show about $9 to $29 per user per month for plans that include invoicing.', 'Teamwork offers a free plan for small teams, so Orbyte plans a free Starter.', 'AI is capped by a daily budget per organization, so it can be included in the plans.', 'Indonesian prices are set in Rupiah, lower than the global USD prices.'] },
      { heading: 'About the limits', paragraphs: ['Planned limits such as meeting hours and image counts will be confirmed against measured usage before billing starts.'] },
    ],
  },
  compare: {
    title: 'Orbyte vs Agency Project and Billing Tools',
    description: 'Public prices of Teamwork, Productive, Bonsai and Scoro, with sources and dates, and how Orbyte differs: AI alerts that need human approval.',
    h1: 'Orbyte compared with agency project management and billing tools',
    answer:
      'Tools such as Teamwork, Productive, Bonsai and Scoro combine projects, time and billing, with prices from about $9 to $57 per user per month. Orbyte is a different shape: an AI layer where alerts and drafts need human approval. This page lists their public prices with sources and dates.',
    updated,
    sections: [
      { heading: 'How to read this comparison', paragraphs: ['Prices come from each vendor\'s own public pricing page, read on 28 October 2026. Features differ between products, so this page compares prices and does not claim that any product is better. Check the vendor pages for current figures.'] },
      { heading: 'What Orbyte focuses on', bullets: ['Alerts raised by rules, not by someone remembering to check.', 'AI drafts that always wait for a person.', 'An change history that records both people and AI.'] },
    ],
  },
  faq: {
    title: 'Orbyte FAQ: Features, AI Limits, Pricing, Data',
    description: 'Direct answers about what Orbyte is, who it is for, what its AI can and cannot do, what is available today, pricing and data handling.',
    h1: 'Frequently asked questions',
    answer:
      'Short, direct answers about what {brand} is, who it is for, what its AI can and cannot do, what is available today, how planned pricing works, and how your data is stored and protected. If something is not available yet, the answer says so.',
    updated,
    faq: [
      { q: 'What is {brand}?', a: '{brand} is an AI business operating system for agencies and software houses. It keeps clients, subscriptions, invoices, leads and tasks in one system, lets AI find problems and draft next steps, and requires human approval before risky actions.' },
      { q: 'Who is it for?', a: 'Small and mid-size agencies and software houses of about 3 to 50 people that currently join project tools, billing and meeting notes together by hand.' },
      { q: 'Does the AI act on its own?', a: 'No. AI can read your data, explain it and write drafts. Anything risky waits for a person to approve, and AI cannot change payments, invoice amounts or prices.' },
      { q: 'Which AI models does it use?', a: "{brand} uses Meta's Model API, including Muse Spark for reasoning and drafting, Muse Voice Transcribe for speech and Muse Image for images. Every model call is recorded and capped by a daily budget." },
      { q: 'Can it send invoices to my clients automatically?', a: 'No. You mark an invoice as sent, download the PDF or copy the message. Automatic sending to clients is not part of the product.' },
      { q: 'Is my data separate from other organizations?', a: "Yes. Each organization's data is isolated in application code and enforced again by database constraints." },
      { q: 'What can I use today?', a: 'Early access is open: you can create an organization and sign in. Other modules are in development or planned, and each is marked with its real status on the home page and on the feature pages.' },
      { q: 'How much does it cost?', a: 'Early access is free. Planned plans are Starter (free), Team at $15 and Business at $29 per user per month billed annually; billing is not live yet. See the pricing page for details and sources.' },
      { q: 'Can I delete my data?', a: 'Self-service account deletion is not available yet. Write to {email} and your data will be removed on request.' },
      { q: 'Does it create video or voice?', a: 'No. Marketing Studio creates images and captions only. Orbyte does not generate video or voice.' },
    ],
  },
  about: {
    title: 'About Orbyte and Its Maker, ASIIFDEV',
    description: 'Orbyte is built by PT Asiifdev Digital Agency (ASIIFDEV), an AI engineering and software company in Boyolali, Indonesia, during the Meta hackathon.',
    h1: 'About Orbyte',
    answer:
      'Orbyte is built by PT Asiifdev Digital Agency (ASIIFDEV), an AI engineering and software company founded in 2021 in Boyolali, Central Java, Indonesia. It is being developed in the open during the Meta Global AI Developer Hackathon, from 26 October to 4 November 2026, using the Meta Model API.',
    updated,
    sections: [
      { heading: 'Why it exists', paragraphs: ['Agencies and software houses run on many separate tools. Invoices go overdue because nobody checked, meeting decisions are lost, and AI tools that act on their own are hard to trust. Orbyte is an attempt at the opposite: structured data, AI that drafts, and a person who decides.'] },
      { heading: 'How it is built', bullets: ['Astro and React for the web app, PostgreSQL for data.', "Meta's Model API for language, speech and image models.", 'A public source repository with documentation written before the code.'] },
    ],
  },
  contact: {
    title: 'Contact Orbyte',
    description: 'Contact the Orbyte team by email for questions, early-access feedback, security reports or data requests.',
    h1: 'Contact',
    answer:
      'Write to {email} for questions, early-access feedback, security reports or data requests such as deleting your account. We reply by email. There is no phone line or live chat yet, and nothing you send is added to a mailing list.',
    updated,
  },
  changelog: {
    title: 'Orbyte Changelog',
    description: 'A running list of what has changed in Orbyte, generated from the changelog file in the project repository.',
    h1: 'Changelog',
    answer:
      "A running list of what has changed in {brand}, generated from the project's changelog file. Items under Unreleased are built but not yet part of a numbered release. The status list on the home page shows which capabilities are available today.",
    updated,
  },
  privacy: {
    title: 'Orbyte Privacy and Data Practices',
    description: 'What data Orbyte stores or processes today, where, by whom, which cookies and local storage it uses, and what is not available yet.',
    h1: 'Privacy and data practices',
    answer:
      'This page describes the data {brand} actually stores or processes today, where, and by whom. It is generated from a registry that automated tests keep in step with the code. It states what is not available yet, such as self-service account deletion, and it is an explanation of practices, not legal advice.',
    updated,
  },
  terms: {
    title: 'Orbyte Terms of Use (Early Access)',
    description: 'Plain-language terms for the Orbyte early-access service: use with non-sensitive data, expect changes, AI output is a draft.',
    h1: 'Terms of use (early access)',
    answer:
      'Orbyte is in early access. Use it with demo or non-sensitive data, expect changes and interruptions, and do not rely on it as your only record of invoices or payments yet. These terms describe the current service in plain language and are not a substitute for professional legal advice.',
    updated,
    sections: [
      { heading: 'Using the service', bullets: ['You are responsible for the data you enter and for keeping your password secret.', 'Do not use the service for anything unlawful or to attack the service or other users.', 'AI output is a draft: you are responsible for checking it before you rely on it.'] },
      { heading: 'Early-access limits', bullets: ['The service is provided as it is, without warranties, and may change or stop.', 'Features marked in development or planned may not work or may not exist yet.', 'We may suspend accounts that abuse the service, for example by creating many accounts to use AI capacity.'] },
      { heading: 'Contact', paragraphs: ['Questions about these terms: {email}.'] },
    ],
  },
};
