/**
 * notifiers.ts — destinos de notificacao injetaveis.
 *
 * Componente da patente US 8,763,078 (implementacao independente): o envio de
 * notificacoes e abstraido pela interface `Notifier`, permitindo plugar
 * e-mail/SMS reais depois. Fornece `ConsoleNotifier` (default) e
 * `InMemoryNotifier` (testes).
 */

export type NotificationChannel = 'email' | 'sms';

export interface OutgoingNotification {
  channel: NotificationChannel;
  to: string;
  subject: string;
  body: string;
}

export interface Notifier {
  send(notification: OutgoingNotification): void | Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  send(notification: OutgoingNotification): void {
    // eslint-disable-next-line no-console
    console.log(
      `[notifier:${notification.channel}] para=${notification.to} assunto="${notification.subject}"\n${notification.body}`,
    );
  }
}

export class InMemoryNotifier implements Notifier {
  readonly sent: OutgoingNotification[] = [];

  send(notification: OutgoingNotification): void {
    this.sent.push(notification);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
