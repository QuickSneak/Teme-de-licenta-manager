import nodemailer from 'nodemailer';

type MailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for email delivery.`);
  return value;
}

function smtpPort() {
  const rawPort = process.env.SMTP_PORT ?? '587';
  const port = Number(rawPort);
  if (!Number.isInteger(port)) throw new Error('SMTP_PORT must be a number.');
  return port;
}

export async function sendMail(input: MailInput) {
  const user = requiredEnv('SMTP_USER');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: smtpPort(),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user,
      pass: requiredEnv('SMTP_PASS')
    }
  });

  await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME ?? 'UAB Thesis Portal'}" <${user}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html
  });
}

export async function sendVerificationEmail(to: string, url: string) {
  await sendMail({
    to,
    subject: 'Verify your UAB Thesis Portal account',
    text: `Open this link to verify your account: ${url}\n\nThis link expires in 1 hour.`,
    html: `
      <p>Open this link to verify your UAB Thesis Portal account:</p>
      <p><a href="${url}">Verify account</a></p>
      <p>This link expires in 1 hour.</p>
    `
  });
}

export async function sendPasswordResetEmail(to: string, url: string) {
  await sendMail({
    to,
    subject: 'Reset your UAB Thesis Portal password',
    text: `Open this link to reset your password: ${url}\n\nThis link expires in 1 hour.`,
    html: `
      <p>Open this link to reset your UAB Thesis Portal password:</p>
      <p><a href="${url}">Reset password</a></p>
      <p>This link expires in 1 hour.</p>
    `
  });
}
