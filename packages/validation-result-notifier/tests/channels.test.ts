import { describe, expect, it } from 'vitest';
import {
  CHANNEL_NAMES,
  createDefaultChannels,
  DebuggerNotificationSink,
  EmailChannel,
  FakeMailSender,
  FakePopupSink,
  PopupChannel,
  routeChannel,
  type DeliveredIndication,
} from '../src/core/channels.js';

const indication: DeliveredIndication = {
  channel: 'debugger',
  form: 'message',
  severity: 'error',
  conditionId: 'c1',
  content: 'conteúdo renderizado',
};

describe('canal (a) notificação em debugger application — sink em memória', () => {
  it('captura indicações entregues', () => {
    const sink = new DebuggerNotificationSink();
    sink.deliver(indication);
    sink.deliver({ ...indication, conditionId: 'c2' });
    expect(sink.name).toBe('debugger');
    expect(sink.delivered.map((d) => d.conditionId)).toEqual(['c1', 'c2']);
  });
});

describe('canal (b) email — MailSender injetável com fake', () => {
  it('envia MailMessage via fake e registra a indicação', () => {
    const mailer = new FakeMailSender();
    const channel = new EmailChannel(mailer, 'ops@example.com');
    channel.deliver({ ...indication, channel: 'email' });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toEqual({
      to: 'ops@example.com',
      subject: '[ERROR] validação c1 (message)',
      body: 'conteúdo renderizado',
    });
    expect(channel.delivered).toHaveLength(1);
  });
});

describe('canal (c) popup window — PopupSink injetável com fake', () => {
  it('exibe PopupNotice via fake e registra a indicação', () => {
    const popup = new FakePopupSink();
    const channel = new PopupChannel(popup);
    channel.deliver({ ...indication, channel: 'popup', severity: 'critical' });
    expect(popup.shown).toEqual([
      { title: 'Validação — c1', message: 'conteúdo renderizado', severity: 'critical' },
    ]);
    expect(channel.delivered).toHaveLength(1);
  });
});

describe('ChannelRouter — escolha por severidade/config', () => {
  it('usa o canal mapeado para a severidade', () => {
    expect(
      routeChannel('error', { fallback: 'debugger', bySeverity: { error: 'popup', critical: 'email' } }),
    ).toBe('popup');
    expect(
      routeChannel('critical', { fallback: 'debugger', bySeverity: { error: 'popup', critical: 'email' } }),
    ).toBe('email');
  });

  it('cai no fallback quando a severidade não tem mapeamento', () => {
    expect(routeChannel('info', { fallback: 'debugger', bySeverity: { error: 'popup' } })).toBe('debugger');
    expect(routeChannel('warning', { fallback: 'email' })).toBe('email');
  });
});

describe('createDefaultChannels', () => {
  it('expõe os 3 canais com fakes capturáveis', () => {
    const defaults = createDefaultChannels();
    expect(Object.keys(defaults.channels).sort()).toEqual([...CHANNEL_NAMES].sort());
    defaults.channels['email']?.deliver({ ...indication, channel: 'email' });
    defaults.channels['popup']?.deliver({ ...indication, channel: 'popup' });
    expect(defaults.mailSender.sent).toHaveLength(1);
    expect(defaults.popupSink.shown).toHaveLength(1);
    expect(defaults.debuggerSink.delivered).toHaveLength(0);
  });
});
