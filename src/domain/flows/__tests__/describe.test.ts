import { describe, expect, it } from 'vitest';
import { TOOLS, getTool } from '../tools';
import { describeFields } from '../tools/describe';

describe('settings forms come from the tools\' own schemas', () => {
  it('every tool is described, and nothing throws', () => {
    for (const t of TOOLS) expect(Array.isArray(describeFields(t)), t.id).toBe(true);
  });
  it('reads types, options, defaults, optional and multiline', () => {
    const artisan = describeFields(getTool('ssh.artisan')!);
    expect(artisan.find((f) => f.key === 'command')).toMatchObject({ type: 'select', optional: false });
    expect(artisan.find((f) => f.key === 'command')!.options).toContain('migrate');
    expect(artisan.find((f) => f.key === 'dir')).toMatchObject({ type: 'text', optional: false });
    const ports = describeFields(getTool('ssh.list_ports')!);
    expect(ports.find((f) => f.key === 'from')).toMatchObject({ type: 'number' });
    const secret = describeFields(getTool('orbyte.generate_secret')!);
    expect(secret.find((f) => f.key === 'length')).toMatchObject({ type: 'number', default: 32, optional: true });
    expect(secret.find((f) => f.key === 'alphabet')).toMatchObject({ type: 'select', default: 'alnum' });
    const env = describeFields(getTool('ssh.env_set')!);
    expect(env.find((f) => f.key === 'entries')).toMatchObject({ multiline: true, secret: true });
    expect(env.find((f) => f.key === 'from_example')).toMatchObject({ type: 'boolean', default: true });
    const cmd = describeFields(getTool('ssh.run_command')!);
    expect(cmd.find((f) => f.key === 'script')).toMatchObject({ multiline: true });
    const db = describeFields(getTool('panel.create_database')!);
    expect(db.find((f) => f.key === 'password')).toMatchObject({ secret: true });
    expect(db.find((f) => f.key === 'user')).toMatchObject({ optional: true });
  });
});
