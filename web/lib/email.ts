import { Resend } from 'resend';

/**
 * Shared email-sending library. Gracefully no-ops when no Resend API key is
 * configured so local review and tests never fail on missing credentials.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; skipped?: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, skipped: true };
  }
  try {
    const resend = new Resend(apiKey);
    const from =
      process.env.RESEND_FROM || 'managemyteam.io <noreply@managemyteam.io>';
    const { error } = await resend.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    if (error) {
      console.error('sendEmail failed:', error);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error('sendEmail threw:', err);
    return { sent: false };
  }
}
