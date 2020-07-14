import { createHash } from 'crypto';
import * as micromatch from 'micromatch';
import * as path from 'path';
import { Compiler } from 'webpack';
import { Source, RawSource } from 'webpack-sources';

const pluginName = 'asset-sha-webpack-plugin';

interface Asset {
  name: string;
  source: Source;
  info: { immutable?: boolean };
}

type HashingAlgorithm = 'sha256' | 'sha384' | 'sha512';

interface AssetShaWebpackPluginOptions {
  readonly assetPatterns?: ReadonlyArray<string>;
  readonly hashingAlgorithm?: HashingAlgorithm;
  readonly outFile?: string;
  readonly compact?: boolean;
}

/**
 *
 * @extends {import("webpack").Plugin}
 */
export class AssetShaWebpackPlugin {
  private readonly assets: ReadonlyArray<string>;
  private readonly hashingAlgorithm: HashingAlgorithm;
  private readonly outFile: string;
  private readonly compact: boolean;

  public constructor(
    {
      assetPatterns = ['*.css'],
      hashingAlgorithm = 'sha256',
      outFile = 'sha-hashes.json',
      compact = true,
    }: AssetShaWebpackPluginOptions = {},
  ) {
    this.assets = assetPatterns;
    this.hashingAlgorithm = hashingAlgorithm;
    this.outFile = outFile;
    this.compact = compact;
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.emit.tap(pluginName, ($compilation: any/* : compilation.Compilation & { getAssets(): any[] } */) => {
      const patterns = this.assets;
      const result: PluginResult = this.compact ? new CompactResult(this.hashingAlgorithm) : new Result(this.hashingAlgorithm);

      const assets = $compilation.getAssets() as ReadonlyArray<Asset>;
      for (const asset of assets) {
        const assetName = asset.name;
        const fileName = path.basename(assetName);

        if (!micromatch.isMatch(fileName, patterns)) { continue; }

        const source = asset.source.source(Object.create(null));
        if (typeof source !== 'string') {
          throw new Error('Asset source is not string. Non-string sources, such as ArrayBuffer, are not yet supported.');
        }
        result.add(assetName, source);
      }

      $compilation.emitAsset(this.outFile, new RawSource(JSON.stringify(result)));
    });
  }
}

interface PluginResult {
  readonly hashingAlgorithm: HashingAlgorithm;
  add(assetName: string, assetSource: string): void;
}

/**
 * Output schema:
 * ```typescript
 * {
 *   hashingAlgorithm: 'sha256' | 'sha384' | 'sha512',
 *   hashes: { [strAssetPath]: strAssetHash },
 * }
 * ```
 */
class Result implements PluginResult {
  private readonly hashes: Record<string, string>;
  public constructor(
    public readonly hashingAlgorithm: HashingAlgorithm,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.hashes = Object.create(null);
  }

  public add(assetName: string, assetSource: string) {
    this.hashes[assetName] = generateHash(this.hashingAlgorithm, assetSource);
  }
}

/**
 * Output schema:
 * ```typescript
 * {
 *   hashingAlgorithm: 'sha256' | 'sha384' | 'sha512',
 *   hashes: { [strAssetExtension]: [strAsset1Hash, strAsset2Hash] },
 * }
 * ```
 */
class CompactResult implements PluginResult {
  private readonly hashes: Record<string, string[]>;
  public constructor(
    public readonly hashingAlgorithm: HashingAlgorithm,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.hashes = Object.create(null);
  }

  public add(assetName: string, assetSource: string) {
    const hash = generateHash(this.hashingAlgorithm, assetSource);
    const key = path.extname(assetName);
    const hashes = this.hashes;
    let value = hashes[key] ?? null;
    if (value === null) {
      hashes[key] = value = [hash];
    } else {
      value.push(hash);
    }
  }
}

function generateHash(algorithm: string, data: string): string {
  const hash = createHash(algorithm);
  hash.update(data);
  return hash.digest('base64');
}