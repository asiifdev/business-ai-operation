import { ulid } from 'ulid';

/** ULID: 26 characters, sortable by creation time, short enough for Telegram callback_data (ERD section 1). */
export const newId = () => ulid();
