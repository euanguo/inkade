import { InkadeI18nProvider, initInkadeI18n } from "@inkade/i18n";
import { InkadeSdkProvider } from "@inkade/sdk/react";
import { ToastProvider } from "@inkade/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type React from "react";
import { useEffect, useSyncExternalStore } from "react";
import { InspectorProvider } from "./hooks/use-inspector.tsx";
import { getInkadeClient, subscribeInkadeClient } from "./lib/api.ts";
import { installMobileShellBridge } from "./lib/mobile-shell.ts";
import { router } from "./router.tsx";

initInkadeI18n();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function App(): React.ReactElement {
  const inkadeClient = useSyncExternalStore(
    subscribeInkadeClient,
    getInkadeClient,
    getInkadeClient,
  );

  useEffect(() => {
    return installMobileShellBridge({
      queryClient,
      navigateToPath: (path) => {
        void router.navigate({ to: path as never });
      },
    });
  }, []);

  return (
    <InkadeI18nProvider>
      <QueryClientProvider client={queryClient}>
        <InkadeSdkProvider client={inkadeClient}>
          <ToastProvider position="bottom-right">
            <InspectorProvider>
              <RouterProvider router={router} />
            </InspectorProvider>
          </ToastProvider>
        </InkadeSdkProvider>
      </QueryClientProvider>
    </InkadeI18nProvider>
  );
}
