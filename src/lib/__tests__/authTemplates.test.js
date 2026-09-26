import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The branded Supabase auth emails are checked in as Go templates. A template
// that loses its {{ .ConfirmationURL }} would send people a dead email, and a
// config entry pointing at a missing file would fail `supabase config push`.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const config = readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const entries = [...config.matchAll(/\[auth\.email\.template\.(\w+)\]\s*\nsubject = "([^"]+)"\s*\ncontent_path = "([^"]+)"/g)]
  .map((m) => ({ name: m[1], subject: m[2], file: m[3] }));

describe('Supabase auth email templates', () => {
  it('config.toml wires every template to a file that exists', () => {
    expect(entries.map((e) => e.name).sort()).toEqual(['confirmation', 'email_change', 'invite', 'magic_link', 'reauthentication', 'recovery']);
    for (const e of entries) expect(existsSync(path.join(root, e.file)), e.file).toBe(true);
  });
  it.each(entries.map((e) => [e.name, e]))('%s carries its link or code, the brand, and no old name', (_n, e) => {
    const html = readFileSync(path.join(root, e.file), 'utf8');
    expect(html).toContain(e.name === 'reauthentication' ? '{{ .Token }}' : '{{ .ConfirmationURL }}');
    expect(html).toContain('{{ .SiteURL }}');
    expect(html).toMatch(/Round24/);
    expect(html).not.toMatch(/caliper/i);
    expect(e.subject).toMatch(/Round24/);
  });
  it('the app sends recovery links back to /?reset=1 (what opens the new-password screen)', () => {
    const src = readFileSync(path.join(root, 'src/lib/backend/supabase.js'), 'utf8');
    expect(src).toContain("/?reset=1");
    expect(config).toContain('https://round24.app/**');
  });
});
