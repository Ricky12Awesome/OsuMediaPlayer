export function startElectronBootstrap(): Promise<{
  url: string;
  close: () => Promise<void>;
}>;
