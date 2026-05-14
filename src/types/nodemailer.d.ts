declare module 'nodemailer' {
  type SendMailInput = {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  };

  type TransportInput = {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };

  type Transporter = {
    sendMail(input: SendMailInput): Promise<unknown>;
  };

  const nodemailer: {
    createTransport(input: TransportInput): Transporter;
  };

  export default nodemailer;
}
