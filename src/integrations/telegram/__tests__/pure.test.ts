import { describe, expect, it } from 'vitest';
import { encodeApprovalCallback, parseApprovalCallback } from '../callback';
import { generatePairingCode, hashPairingCode, pairingLink, parseStartCommand } from '../pairing';
import { MAX_MESSAGE, chunkText, escapeHtml, escapeHtmlAttr } from '../text';
import { ALLOWED_UPDATES, pickPhoto, updateSchema, verifyWebhookSecret } from '../webhook';

describe('verifyWebhookSecret', () => {
  it('accepts only the exact secret', () => {
    expect(verifyWebhookSecret('s3cret', 's3cret')).toBe(true);
    expect(verifyWebhookSecret('s3creT', 's3cret')).toBe(false);
    expect(verifyWebhookSecret('s3cret-longer', 's3cret')).toBe(false);
  });
  it('rejects everything when the header or the configured secret is missing', () => {
    expect(verifyWebhookSecret(null, 's3cret')).toBe(false);
    expect(verifyWebhookSecret('', 's3cret')).toBe(false);
    expect(verifyWebhookSecret('anything', undefined)).toBe(false);
    expect(verifyWebhookSecret('', '')).toBe(false);
  });
});

describe('approval callback_data', () => {
  const id = '01JBXYZABCDEFGHJKMNPQRSTVW'; // 26-character ULID

  it('round-trips and stays far below 64 bytes', () => {
    const data = encodeApprovalCallback(id, 'y');
    expect(data).toBe(`ap:${id}:y`);
    expect(Buffer.byteLength(data)).toBeLessThan(64);
    expect(parseApprovalCallback(data)).toEqual({ approvalId: id, action: 'y' });
  });

  it.each(['', 'ap:x:z', 'ap::y', 'ap:id with space:y', 'xx:abc:y', `ap:${'a'.repeat(41)}:y`, 'ap:abc:y:extra'])('rejects forged or malformed data %j', (data) => {
    expect(parseApprovalCallback(data)).toBeNull();
  });

  it('treats missing data as no match and refuses to encode an unusable id', () => {
    expect(parseApprovalCallback(undefined)).toBeNull();
    expect(() => encodeApprovalCallback('has space', 'y')).toThrow();
  });
});

describe('pairing', () => {
  it('makes unguessable codes that fit a deep link, and stores only their hash', () => {
    const a = generatePairingCode();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generatePairingCode()).not.toBe(a);
    expect(hashPairingCode(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPairingCode(a)).toBe(hashPairingCode(a));
    expect(hashPairingCode(a)).not.toContain(a);
  });

  it('reads the code from /start and ignores junk', () => {
    const code = generatePairingCode();
    expect(parseStartCommand(`/start ${code}`)).toEqual({ code });
    expect(parseStartCommand(`/start@orbyte_bot ${code}`)).toEqual({ code });
    expect(parseStartCommand('/start')).toEqual({ code: null });
    expect(parseStartCommand('/start short')).toEqual({ code: null });
    expect(parseStartCommand('/start <script>')).toEqual({ code: null });
    expect(parseStartCommand('hello')).toBeNull();
    expect(parseStartCommand(undefined)).toBeNull();
    expect(pairingLink('orbyte_bot', code)).toBe(`https://t.me/orbyte_bot?start=${code}`);
  });
});

describe('text helpers', () => {
  it('escapes the three characters HTML mode needs, and quotes for attributes', () => {
    expect(escapeHtml('A & B <b>x</b>')).toBe('A &amp; B &lt;b&gt;x&lt;/b&gt;');
    expect(escapeHtmlAttr('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it('does not double-escape when applied once to model text', () => {
    expect(escapeHtml('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('splits long text on paragraph breaks without losing anything', () => {
    const paragraph = 'kalimat '.repeat(300).trim();
    const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const parts = chunkText(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('hard-cuts a single unbroken string and keeps short text whole', () => {
    expect(chunkText('x'.repeat(9000)).every((p) => p.length <= MAX_MESSAGE)).toBe(true);
    expect(chunkText('pendek')).toEqual(['pendek']);
  });
});

describe('update parsing', () => {
  it('reads a voice note, a callback and a block event', () => {
    const voice = updateSchema.parse({ update_id: 1, message: { message_id: 2, chat: { id: 9, type: 'private' }, date: 1, from: { id: 9 }, voice: { file_id: 'f', duration: 12 } } });
    expect(voice.message?.voice?.duration).toBe(12);
    const cb = updateSchema.parse({ update_id: 2, callback_query: { id: 'c', from: { id: 9 }, data: 'ap:x:y', message: { message_id: 3, chat: { id: 9, type: 'private' } } } });
    expect(cb.callback_query?.data).toBe('ap:x:y');
    const block = updateSchema.parse({ update_id: 3, my_chat_member: { chat: { id: 9, type: 'private' }, from: { id: 9 }, date: 1, new_chat_member: { status: 'kicked' } } });
    expect(block.my_chat_member?.new_chat_member.status).toBe('kicked');
  });

  it('accepts update kinds we do not use, with every known field absent', () => {
    const other = updateSchema.parse({ update_id: 4, edited_message: { message_id: 1 } });
    expect(other.message ?? other.callback_query ?? other.my_chat_member).toBeUndefined();
  });

  it('rejects a body that is not an update', () => {
    expect(updateSchema.safeParse({ hello: 'world' }).success).toBe(false);
  });

  it('subscribes only to the three update kinds the bot handles', () => {
    expect([...ALLOWED_UPDATES]).toEqual(['message', 'callback_query', 'my_chat_member']);
  });

  it('picks the largest photo that can still be downloaded', () => {
    const photo = [
      { file_id: 's', width: 90, height: 90, file_size: 1000 },
      { file_id: 'm', width: 800, height: 800, file_size: 90000 },
      { file_id: 'huge', width: 5000, height: 5000, file_size: 25 * 1024 * 1024 },
    ];
    expect(pickPhoto(photo)?.file_id).toBe('m');
    expect(pickPhoto([{ file_id: 'huge', width: 5000, height: 5000, file_size: 25 * 1024 * 1024 }])).toBeNull();
    expect(pickPhoto(undefined)).toBeNull();
  });
});
