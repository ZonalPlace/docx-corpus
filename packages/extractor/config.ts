export interface ExtractorConfig {
  database: {
    url: string;
  };
  storage: {
    localPath: string;
  };
  cloudflare: {
    accountId: string;
    r2AccessKeyId: string;
    r2SecretAccessKey: string;
    r2BucketName: string;
  };
  extract: {
    inputPrefix: string;
    outputPrefix: string;
    batchSize: number;
    workers: number;
  };
}

export function loadExtractorConfig(): ExtractorConfig {
  const env = process.env;

  return {
    database: {
      url: env.DATABASE_URL || "",
    },
    storage: {
      localPath: env.STORAGE_PATH || "./corpus",
    },
    cloudflare: {
      accountId: env.CLOUDFLARE_ACCOUNT_ID || "",
      r2AccessKeyId: env.R2_ACCESS_KEY_ID || "",
      r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY || "",
      r2BucketName: env.R2_BUCKET_NAME || "docx-corpus",
    },
    extract: {
      inputPrefix: env.EXTRACT_INPUT_PREFIX || "documents",
      outputPrefix: env.EXTRACT_OUTPUT_PREFIX || "extracted",
      batchSize: parseInt(env.EXTRACT_BATCH_SIZE || "100", 10),
      workers: parseInt(env.EXTRACT_WORKERS || "4", 10),
    },
  };
}

/**
 * Check if Cloudflare credentials are configured
 */
export function hasCloudflareCredentials(config: ExtractorConfig): boolean {
  return !!(
    config.cloudflare.accountId &&
    config.cloudflare.r2AccessKeyId &&
    config.cloudflare.r2SecretAccessKey
  );
}
