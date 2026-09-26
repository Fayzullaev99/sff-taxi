// One-shot job (compose service "storage-init", profile "seaweedfs"): creates the image bucket
// in the bundled SeaweedFS if it does not exist yet. Runs inside the API image, which already
// ships the AWS SDK. Anonymous read access comes from the identities SeaweedFS starts with
// (see the seaweedfs service in docker-compose.prod.yml).
/* global process, console */
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

const { STORAGE_S3_ENDPOINT, STORAGE_S3_REGION, STORAGE_S3_BUCKET } = process.env;
const { STORAGE_S3_ACCESS_KEY, STORAGE_S3_SECRET_KEY } = process.env;

if (!STORAGE_S3_BUCKET || !STORAGE_S3_ACCESS_KEY || !STORAGE_S3_SECRET_KEY) {
  console.log('storage-init: STORAGE_S3_* not set, nothing to do');
  process.exit(0);
}

const s3 = new S3Client({
  endpoint: STORAGE_S3_ENDPOINT,
  region: STORAGE_S3_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: STORAGE_S3_ACCESS_KEY, secretAccessKey: STORAGE_S3_SECRET_KEY },
});

try {
  await s3.send(new HeadBucketCommand({ Bucket: STORAGE_S3_BUCKET }));
  console.log(`storage-init: bucket ${STORAGE_S3_BUCKET} exists`);
} catch (error) {
  if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NotFound') throw error;
  await s3.send(new CreateBucketCommand({ Bucket: STORAGE_S3_BUCKET }));
  console.log(`storage-init: bucket ${STORAGE_S3_BUCKET} created`);
}
