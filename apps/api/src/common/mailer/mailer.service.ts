// ─────────────────────────────────────────────────────────────────────────────
// MAILER SERVICE
// Transactional email (SMTP). When SMTP is not configured (local development)
// the message is logged to the console instead of being sent, so onboarding can
// be exercised end-to-end without real credentials. The boolean return tells
// callers whether a message actually left the building.
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface InvitationEmail {
  to: string;
  organisationName: string;
  inviteUrl: string;
  expiresAt: Date;
}

export interface WorkspaceVerificationEmail {
  to: string;
  name: string;
  organisationName: string;
  code: string;
  expiresInMinutes: number;
}

export interface WorkspaceReadyEmail {
  to: string;
  name: string;
  organisationName: string;
  planName: string;
}

/** Generic notification email for leave-workflow / accrual events. */
export interface NotificationEmail {
  to: string;
  name: string;
  /** Short heading, e.g. "Leave request approved". */
  title: string;
  /** One or two sentence summary. */
  body: string;
  /** Optional relative in-app link (e.g. /time-leave). */
  link?: string;
  appUrl?: string;
}

const PLACEHOLDER = /^(smtp\.example\.com|your-smtp-password|noreply@ascenda\.io)$/i;

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;
  private from = 'Ascenda <noreply@ascenda.io>';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS');
    const from = this.config.get<string>('FROM_EMAIL')?.trim();
    if (from) this.from = from;

    const hasCredentials =
      !!host &&
      !!user &&
      !!pass &&
      !PLACEHOLDER.test(host) &&
      !PLACEHOLDER.test(user) &&
      !PLACEHOLDER.test(pass);

    if (!hasCredentials) {
      this.logger.warn(
        'SMTP is not configured — emails will be logged to the console instead of sent.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    this.logger.log(`Mailer ready (SMTP ${host}:${port})`);
  }

  /** Sends the workspace invitation. Returns true if a message was dispatched. */
  async sendInvitation(email: InvitationEmail): Promise<boolean> {
    const { subject, text, html } = buildInvitation(email);

    if (!this.transporter) {
      this.logger.log(
        `[dev email] Invitation for ${email.to} — set your password: ${email.inviteUrl}`,
      );
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email.to,
        subject,
        text,
        html,
      });
      this.logger.log(`Invitation email sent to ${email.to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send invitation to ${email.to}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /** Send a leave-workflow / accrual notification email. Best-effort. */
  async sendNotification(email: NotificationEmail): Promise<boolean> {
    const { subject, text, html } = buildNotification(email);

    if (!this.transporter) {
      this.logger.log(
        `[dev email] Notification for ${email.to}: ${email.title} — ${email.body}`,
      );
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email.to,
        subject,
        text,
        html,
      });
      this.logger.log(`Notification email sent to ${email.to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send notification to ${email.to}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /** Send the 6-digit workspace verification code used during signup. */
  async sendWorkspaceVerificationCode(
    email: WorkspaceVerificationEmail,
  ): Promise<boolean> {
    const { subject, text, html } = buildWorkspaceVerification(email);

    if (!this.transporter) {
      this.logger.log(
        `[dev email] Workspace verification code for ${email.to}: ${email.code}`,
      );
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email.to,
        subject,
        text,
        html,
      });
      this.logger.log(`Workspace verification code sent to ${email.to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send workspace verification code to ${email.to}: ${
          (error as Error).message
        }`,
      );
      return false;
    }
  }

  /** Confirm the workspace is ready after a successful signup/payment. */
  async sendWorkspaceReady(email: WorkspaceReadyEmail): Promise<boolean> {
    const { subject, text, html } = buildWorkspaceReady(email);

    if (!this.transporter) {
      this.logger.log(
        `[dev email] Workspace ready for ${email.to} (${email.organisationName})`,
      );
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email.to,
        subject,
        text,
        html,
      });
      this.logger.log(`Workspace ready email sent to ${email.to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send workspace ready email to ${email.to}: ${
          (error as Error).message
        }`,
      );
      return false;
    }
  }
}

function buildWorkspaceVerification({
  name,
  organisationName,
  code,
  expiresInMinutes,
}: WorkspaceVerificationEmail): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `${code} is your Ascenda verification code`;
  const firstName = name.trim().split(/\s+/)[0] || 'there';

  const text = [
    `Hi ${firstName},`,
    ``,
    `Use this code to verify your Ascenda workspace for ${organisationName}:`,
    ``,
    `    ${code}`,
    ``,
    `The code expires in ${expiresInMinutes} minutes. If you did not request this, you can safely ignore this email.`,
    ``,
    `— The Ascenda team`,
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:28px 32px 8px;font-size:20px;font-weight:700;">Ascenda</td></tr>
          <tr><td style="padding:8px 32px;font-size:16px;line-height:1.5;">
            <p style="margin:0 0 16px;">Hi ${firstName},</p>
            <p style="margin:0 0 16px;">Use this code to verify your Ascenda workspace for <strong>${organisationName}</strong>:</p>
            <p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:6px;">${code}</p>
            <p style="margin:0 0 8px;font-size:13px;color:#52606d;">The code expires in ${expiresInMinutes} minutes. If you did not request this, you can safely ignore this email.</p>
          </td></tr>
          <tr><td style="padding:16px 32px 32px;font-size:12px;color:#9aa5b1;">Sent by Ascenda</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

function buildWorkspaceReady({
  name,
  organisationName,
  planName,
}: WorkspaceReadyEmail): { subject: string; text: string; html: string } {
  const subject = `Your Ascenda workspace is ready`;
  const firstName = name.trim().split(/\s+/)[0] || 'there';

  const text = [
    `Hi ${firstName},`,
    ``,
    `Your workspace for ${organisationName} is ready on the ${planName} plan.`,
    `Sign in to get started:`,
    ``,
    `— The Ascenda team`,
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:28px 32px 8px;font-size:20px;font-weight:700;">Ascenda</td></tr>
          <tr><td style="padding:8px 32px;font-size:16px;line-height:1.5;">
            <p style="margin:0 0 16px;">Hi ${firstName},</p>
            <p style="margin:0 0 24px;">Your workspace for <strong>${organisationName}</strong> is ready on the <strong>${planName}</strong> plan. You can sign in now and start inviting your team.</p>
          </td></tr>
          <tr><td style="padding:16px 32px 32px;font-size:12px;color:#9aa5b1;">Sent by Ascenda</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

function buildNotification({
  name,
  title,
  body,
  link,
  appUrl,
}: NotificationEmail): { subject: string; text: string; html: string } {
  const firstName = name.trim().split(/\s+/)[0] || 'there';
  const url = link ? `${appUrl ?? ''}${link}` : undefined;

  const text = [
    `Hi ${firstName},`,
    ``,
    title,
    body,
    ...(url ? [``, `Open Ascenda: ${url}`] : []),
    ``,
    `— The Ascenda team`,
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:28px 32px 8px;font-size:20px;font-weight:700;">Ascenda</td></tr>
          <tr><td style="padding:8px 32px;font-size:16px;line-height:1.5;">
            <p style="margin:0 0 16px;">Hi ${firstName},</p>
            <p style="margin:0 0 8px;font-weight:600;">${title}</p>
            <p style="margin:0 0 24px;">${body}</p>
            ${
              url
                ? `<p style="margin:0 0 8px;"><a href="${url}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Open Ascenda</a></p>`
                : ''
            }
          </td></tr>
          <tr><td style="padding:16px 32px 32px;font-size:12px;color:#9aa5b1;">Sent by Ascenda</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject: title, text, html };
}

function buildInvitation({
  organisationName,
  inviteUrl,
  expiresAt,
}: InvitationEmail): { subject: string; text: string; html: string } {
  const expires = expiresAt.toUTCString();
  const subject = `Set up your Ascenda workspace for ${organisationName}`;

  const text = [
    `Welcome to Ascenda`,
    ``,
    `${organisationName} has invited you to their workspace.`,
    `Set your password to activate your account (link expires ${expires}):`,
    inviteUrl,
    ``,
    `If you did not request this, you can safely ignore this email.`,
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:28px 32px 8px;font-size:20px;font-weight:700;">Ascenda</td></tr>
          <tr><td style="padding:8px 32px;font-size:16px;line-height:1.5;">
            <p style="margin:0 0 16px;">Welcome to Ascenda. <strong>${organisationName}</strong> has invited you to their workspace.</p>
            <p style="margin:0 0 24px;">Set your password to activate your account.</p>
            <p style="margin:0 0 24px;">
              <a href="${inviteUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Set your password</a>
            </p>
            <p style="margin:0 0 8px;font-size:13px;color:#52606d;">This link expires on ${expires}. If you did not request this, you can safely ignore this email.</p>
          </td></tr>
          <tr><td style="padding:16px 32px 32px;font-size:12px;color:#9aa5b1;">Sent by Ascenda</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
