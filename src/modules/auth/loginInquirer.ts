import inquirer from 'inquirer';

export async function promptLoginPhone(defaultPhone?: string): Promise<string> {
  const { phone } = await inquirer.prompt<{ phone: string }>([
    {
      type: 'input',
      name: 'phone',
      message: 'Phone number (international, e.g. +79991234567):',
      default: defaultPhone ?? '',
      validate: (v: string) => (v.trim().length > 5 ? true : 'Enter a valid phone'),
    },
  ]);
  return phone.trim();
}

export async function promptLoginCode(isCodeViaApp?: boolean): Promise<string> {
  const where =
    isCodeViaApp === true
      ? 'code shown in the Telegram app (or linked Telegram Desktop)'
      : isCodeViaApp === false
        ? 'code from the SMS Telegram sent to this number'
        : 'Telegram app, SMS, or email (digits only)';
  const { code } = await inquirer.prompt<{ code: string }>([
    {
      type: 'input',
      name: 'code',
      message: `Login code (${where}) — digits only, not your phone number:`,
      filter: (v: string) => v.replace(/\D/g, ''),
      validate: (v: string) => {
        const d = v.replace(/\D/g, '');
        if (d.length >= 4 && d.length <= 6) return true;
        if (d.length >= 9) {
          return 'That looks like a phone number. Enter the login code Telegram sent (usually 5 digits).';
        }
        return 'Enter the code digits only (typically 5 digits). Request a new code if it expired.';
      },
    },
  ]);
  return code.replace(/\D/g, '');
}

export async function promptTwoFactorPassword(): Promise<string> {
  const { pw } = await inquirer.prompt<{ pw: string }>([
    {
      type: 'password',
      name: 'pw',
      message: '2FA password (leave empty if none):',
      mask: '*',
    },
  ]);
  return pw?.trim() ?? '';
}
