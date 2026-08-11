/**
 * validation-result-notifier — src/core/channels.ts
 *
 * Implementação funcional INDEPENDENTE (reimplementação original, sem copiar texto
 * dos claims) dos mecanismos da patente US 10.572.529 B2 (Palantir/Nassar,
 * "Data Integration Tool").
 *
 * Componente implementado: canais de entrega da indicação expressed — notificação
 * em debugger application (sink em memória), email (interface MailSender injetável
 * com fake capturável) e popup window (interface PopupSink injetável com fake
 * capturável). Inclui o ChannelRouter que escolhe o canal por severidade/config.
 */

import type { RenderForm } from './renderers.js';
import type { Severity } from './types.js';

export type ChannelName = 'debugger' | 'email' | 'popup';

export const CHANNEL_NAMES: readonly ChannelName[] = ['debugger', 'email', 'popup'];

/** Indicação entregue a um canal (conteúdo já renderizado em uma forma). */
export interface DeliveredIndication {
  channel: ChannelName;
  form: RenderForm;
  severity: Severity;
  conditionId: string;
  content: string;
}

/** Abstração de canal de notificação: toda implementação é capturável. */
export interface NotificationChannel {
  readonly name: ChannelName;
  readonly delivered: DeliveredIndication[];
  deliver(indication: DeliveredIndication): void;
}

/** Notificação em debugger application: sink em memória. */
export class DebuggerNotificationSink implements NotificationChannel {
  readonly name = 'debugger' as const;
  readonly delivered: DeliveredIndication[] = [];

  deliver(indication: DeliveredIndication): void {
    this.delivered.push(indication);
  }
}

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

/** Interface injetável de envio de email. */
export interface MailSender {
  send(message: MailMessage): void;
}

/** Fake determinístico de MailSender para testes e para o servidor. */
export class FakeMailSender implements MailSender {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): void {
    this.sent.push(message);
  }
}

/** Canal de email: converte a indicação em MailMessage e a registra. */
export class EmailChannel implements NotificationChannel {
  readonly name = 'email' as const;
  readonly delivered: DeliveredIndication[] = [];

  constructor(
    private readonly mailer: MailSender,
    private readonly to: string,
  ) {}

  deliver(indication: DeliveredIndication): void {
    this.mailer.send({
      to: this.to,
      subject: `[${indication.severity.toUpperCase()}] validação ${indication.conditionId} (${indication.form})`,
      body: indication.content,
    });
    this.delivered.push(indication);
  }
}

export interface PopupNotice {
  title: string;
  message: string;
  severity: Severity;
}

/** Interface injetável de popup window. */
export interface PopupSink {
  show(notice: PopupNotice): void;
}

/** Fake determinístico de PopupSink para testes e para o servidor. */
export class FakePopupSink implements PopupSink {
  readonly shown: PopupNotice[] = [];

  show(notice: PopupNotice): void {
    this.shown.push(notice);
  }
}

/** Canal de popup window: converte a indicação em PopupNotice e a registra. */
export class PopupChannel implements NotificationChannel {
  readonly name = 'popup' as const;
  readonly delivered: DeliveredIndication[] = [];

  constructor(private readonly sink: PopupSink) {}

  deliver(indication: DeliveredIndication): void {
    this.sink.show({
      title: `Validação — ${indication.conditionId}`,
      message: indication.content,
      severity: indication.severity,
    });
    this.delivered.push(indication);
  }
}

/** Configuração de roteamento: canal por severidade + fallback. */
export interface ChannelRouterConfig {
  fallback: ChannelName;
  bySeverity?: Partial<Record<Severity, ChannelName>>;
}

/** Escolhe o canal conforme severidade/config. */
export function routeChannel(severity: Severity, config: ChannelRouterConfig): ChannelName {
  return config.bySeverity?.[severity] ?? config.fallback;
}

export interface DefaultChannels {
  channels: Record<ChannelName, NotificationChannel>;
  debuggerSink: DebuggerNotificationSink;
  mailSender: FakeMailSender;
  popupSink: FakePopupSink;
}

/** Conjunto padrão de canais com fakes capturáveis (usado pelo servidor e demos). */
export function createDefaultChannels(emailTo = 'alerts@example.com'): DefaultChannels {
  const debuggerSink = new DebuggerNotificationSink();
  const mailSender = new FakeMailSender();
  const popupSink = new FakePopupSink();
  return {
    debuggerSink,
    mailSender,
    popupSink,
    channels: {
      debugger: debuggerSink,
      email: new EmailChannel(mailSender, emailTo),
      popup: new PopupChannel(popupSink),
    },
  };
}
