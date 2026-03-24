import nodemailer from 'nodemailer';
import logger from '../config/logger';
import { NotificationPayload, DeliveryResult } from '../types/reminder';
import { withRetry, RetryableError, NonRetryableError } from '../utils/retry';
import { sanitizeUrl } from '../utils/sanitize-url';

export interface EmailConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  from: string;
}

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private fromEmail: string;

  constructor(config?: EmailConfig) {
    this.fromEmail = config?.from || process.env.EMAIL_FROM || 'noreply@synchro.app';

    // Initialize transporter based on config
    if (config?.host) {
      // SMTP configuration
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port || 587,
        secure: config.secure || false,
        auth: config.auth,
      });
    } else if (process.env.SMTP_HOST) {
      // SMTP from environment variables
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASSWORD || '',
        },
      });
    } else {
      // Use SendGrid, Mailgun, or other service via API
      // For now, log that email service is not configured
      logger.warn('Email service not fully configured. Using mock transporter.');
      this.transporter = nodemailer.createTransport({
        jsonTransport: true, // Mock transport for development
      });
    }
  }

  /**
   * Verify email service connection
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      logger.info('Email service connection verified');
      return true;
    } catch (error) {
      logger.error('Email service connection failed:', error);
      return false;
    }
  }

  /**
   * Send renewal reminder email with retry logic
   */
  async sendReminderEmail(
    recipientEmail: string,
    payload: NotificationPayload,
    options: { maxAttempts?: number } = {}
  ): Promise<DeliveryResult> {
    const { maxAttempts = 3 } = options;

    try {
      return await withRetry(
        async () => {
          const subject = this.getEmailSubject(payload);
          const html = this.getEmailTemplate(payload);

          if (!this.transporter) {
            throw new NonRetryableError('Email transporter not configured');
          }

          const info = await this.transporter.sendMail({
            from: this.fromEmail,
            to: recipientEmail,
            subject,
            html,
            text: this.getEmailText(payload),
          });

          logger.info(`Email sent successfully to ${recipientEmail}`, {
            messageId: info.messageId,
          });

          return {
            success: true,
            metadata: {
              messageId: info.messageId,
              accepted: info.accepted,
              rejected: info.rejected,
            },
          };
        },
        { maxAttempts }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      
      // Determine if error is retryable
      const isRetryable = this.isRetryableError(error);

      logger.error(`Failed to send email to ${recipientEmail}:`, errorMessage);

      return {
        success: false,
        error: errorMessage,
        metadata: {
          retryable: isRetryable,
        },
      };
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof NonRetryableError) {
      return false;
    }

    if (error instanceof RetryableError) {
      return true;
    }

    // Network errors and timeouts are retryable
    const errorMessage = error instanceof Error ? error.message : String(error);
    const retryablePatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /econnrefused/i,
      /etimedout/i,
      /temporary/i,
      /rate limit/i,
      /503/i,
      /502/i,
      /504/i,
    ];

    return retryablePatterns.some((pattern) => pattern.test(errorMessage));
  }

  /**
   * Generate email subject
   */
  private getEmailSubject(payload: NotificationPayload): string {
    const { subscription, daysBefore, reminderType } = payload;

    if (reminderType === 'renewal') {
      if (daysBefore === 0) {
        return `⚠️ ${subscription.name} renews today`;
      }
      return `📅 ${subscription.name} renews in ${daysBefore} day${daysBefore > 1 ? 's' : ''}`;
    }

    if (reminderType === 'trial_expiry') {
      return `⏰ ${subscription.name} trial expires soon`;
    }

    return `🔔 ${subscription.name} reminder`;
  }

  /**
   * Generate email HTML template
   */
  private getEmailTemplate(payload: NotificationPayload): string {
    const { subscription, daysBefore, renewalDate, reminderType } = payload;
    const renewalDateFormatted = new Date(renewalDate).toLocaleDateString(
      'en-US',
      { year: 'numeric', month: 'long', day: 'numeric' }
    );

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Subscription Reminder</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Subscription Reminder</h1>
  </div>
  
  <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
    <h2 style="color: #333; margin-top: 0;">${this.getEmailSubject(payload).replace(/[📅⚠️⏰🔔]/g, '')}</h2>
    
    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
      <p style="margin: 0 0 10px 0;"><strong>Service:</strong> ${subscription.name}</p>
      <p style="margin: 0 0 10px 0;"><strong>Category:</strong> ${subscription.category}</p>
      <p style="margin: 0 0 10px 0;"><strong>Price:</strong> $${subscription.price.toFixed(2)}/${subscription.billing_cycle}</p>
      <p style="margin: 0 0 10px 0;"><strong>Renewal Date:</strong> ${renewalDateFormatted}</p>
      ${daysBefore > 0 ? `<p style="margin: 0;"><strong>Days Remaining:</strong> ${daysBefore}</p>` : ''}
    </div>

    ${subscription.renewal_url ? `
    <div style="text-align: center; margin: 30px 0;">
      <a href="${sanitizeUrl(subscription.renewal_url)}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
        Manage Subscription
      </a>
    </div>
    ` : ''}

    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      This is an automated reminder from Synchro. You're receiving this because you have a subscription renewal coming up.
    </p>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Generate plain text email
   */
  private getEmailText(payload: NotificationPayload): string {
    const { subscription, daysBefore, renewalDate } = payload;
    const renewalDateFormatted = new Date(renewalDate).toLocaleDateString(
      'en-US',
      { year: 'numeric', month: 'long', day: 'numeric' }
    );

    return `
Subscription Reminder

${subscription.name} renews in ${daysBefore} day${daysBefore > 1 ? 's' : ''}

Service: ${subscription.name}
Category: ${subscription.category}
Price: $${subscription.price.toFixed(2)}/${subscription.billing_cycle}
Renewal Date: ${renewalDateFormatted}
${daysBefore > 0 ? `Days Remaining: ${daysBefore}` : ''}

${subscription.renewal_url ? `Manage Subscription: ${sanitizeUrl(subscription.renewal_url)}` : ''}

This is an automated reminder from Synchro.
    `.trim();
  }
}

export const emailService = new EmailService();

