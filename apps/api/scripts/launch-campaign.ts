/**
 * Development entry point of the launch campaign script (the built one is
 * dist/scripts/launch-campaign.cli.js, see src/scripts/launch-campaign.cli.ts):
 *
 *   npx tsx --env-file-if-exists=.env scripts/launch-campaign.ts            # dry run
 *   npx tsx --env-file-if-exists=.env scripts/launch-campaign.ts --apply
 */
import '../src/scripts/launch-campaign.cli.js';
