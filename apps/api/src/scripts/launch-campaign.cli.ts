/**
 * Creates (or updates) the launch campaign: the GULISTON promo code and the referral
 * settings (src/lib/launch-campaign.ts), through the same services the operator panel
 * uses. Idempotent: run it again after changing the campaign definition.
 *
 *   # locally (apps/api, .env as for the API):
 *   npx tsx scripts/launch-campaign.ts                 # dry run: prints the plan
 *   npx tsx scripts/launch-campaign.ts --apply
 *   # in production, inside the API image (docs/deploy.md "Launch campaign"):
 *   deploy/compose.sh run --rm api node dist/scripts/launch-campaign.cli.js --apply --production
 *
 * Options: --apply (write; without it nothing changes), --production (required when
 * NODE_ENV=production, so a copied command cannot touch the live database by accident),
 * --invite-url=https://taxi.example.uz/invite (default: SHARE_BASE_URL + /invite),
 * --admin-phone=+998... (the operator recorded as the code's author; default: the first
 * of ADMIN_PHONES, who must have signed in to the panel once).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { ENV, type Env } from '../config/env.js';
import { Database } from '../core/db/database.js';
import { applyLaunchCampaign, describeCampaign, LAUNCH_CAMPAIGN } from '../lib/launch-campaign.js';
import { PromosService } from '../modules/promos/promos.service.js';
import { SettingsService } from '../modules/settings/settings.module.js';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
  if (!m) throw new Error(`Unknown argument ${a}`);
  args.set(m[1]!, m[2] ?? 'true');
}
const apply = args.get('apply') === 'true';

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const env = app.get<Env>(ENV);
  const inviteUrl = args.get('invite-url') ?? `${env.SHARE_BASE_URL.replace(/\/+$/, '')}/invite`;
  console.log(describeCampaign(LAUNCH_CAMPAIGN, inviteUrl));
  if (!apply) {
    console.log('\nDry run. Add --apply to write this.');
  } else {
    if (env.NODE_ENV === 'production' && args.get('production') !== 'true') {
      throw new Error('NODE_ENV=production: add --production to confirm the live database');
    }
    const phone = args.get('admin-phone') ?? env.ADMIN_PHONES[0];
    if (!phone) throw new Error('No operator: set ADMIN_PHONES or pass --admin-phone');
    const admin = await app
      .get(Database)
      .kysely.selectFrom('users')
      .select(['id', 'phone', 'full_name'])
      .where('phone', '=', phone)
      .executeTakeFirst();
    if (!admin) {
      throw new Error(`Operator ${phone} has no account yet: sign in to the panel once first`);
    }
    const result = await applyLaunchCampaign(
      {
        promos: app.get(PromosService),
        settings: app.get(SettingsService),
        admin: { userId: admin.id, phone: admin.phone, fullName: admin.full_name, isAdmin: true },
      },
      LAUNCH_CAMPAIGN,
      inviteUrl,
    );
    console.log(`\nPromo ${result.promo.code} ${result.promo.action} (${result.promo.id})`);
    console.log(`Referral settings written; invite_url=${result.settings.invite_url}`);
  }
} finally {
  await app.close();
}
