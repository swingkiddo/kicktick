import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Keypair, PublicKey, type Transaction, type VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';

export interface TestWallet {
  name: string;
  publicKey: PublicKey;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signTransaction: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(transactions: T[]) => Promise<T[]>;
}

interface TestWalletContextValue {
  wallets: TestWallet[];
  selected?: TestWallet;
  select: (publicKey: string) => void;
  loading: boolean;
  error?: string;
}

const Context = createContext<TestWalletContextValue | undefined>(undefined);
const enabled = import.meta.env.DEV;

export function TestWalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<TestWallet[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const name = `wallet-${String(index + 1).padStart(2, '0')}`;
      const response = await fetch(`/wallets/${name}.json`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${name}.json is unavailable`);
      const secret = new Uint8Array(await response.json() as number[]);
      const keypair = Keypair.fromSecretKey(secret);
      return {
        name,
        publicKey: keypair.publicKey,
        signMessage: async (message: Uint8Array) => nacl.sign.detached(message, keypair.secretKey),
        signTransaction: async <T extends Transaction | VersionedTransaction>(transaction: T) => {
          if ('partialSign' in transaction) transaction.partialSign(keypair);
          else transaction.sign([keypair]);
          return transaction;
        },
        signAllTransactions: async <T extends Transaction | VersionedTransaction>(transactions: T[]) => {
          for (const transaction of transactions) {
            if ('partialSign' in transaction) transaction.partialSign(keypair);
            else transaction.sign([keypair]);
          }
          return transactions;
        },
      } satisfies TestWallet;
    })).then((loaded) => {
      if (!cancelled) { setWallets(loaded); setSelectedKey(loaded[0]?.publicKey.toBase58()); setLoading(false); }
    }).catch((reason: unknown) => {
      if (!cancelled) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  const select = useCallback((publicKey: string) => setSelectedKey(publicKey), []);
  const selected = useMemo(() => wallets.find(wallet => wallet.publicKey.toBase58() === selectedKey), [selectedKey, wallets]);
  return <Context.Provider value={{ wallets, selected, select, loading, error }}>{children}</Context.Provider>;
}

export function useTestWallets() {
  const context = useContext(Context);
  if (!context) throw new Error('useTestWallets must be used within TestWalletProvider.');
  return context;
}
