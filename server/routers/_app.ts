import { router } from "../trpc";
import { accountRouter } from "./account";
import { holidayRouter } from "./holiday";
import { particularRouter } from "./particular";
import { forecastRouter } from "./forecast";

export const appRouter = router({
  account: accountRouter,
  holiday: holidayRouter,
  particular: particularRouter,
  forecast: forecastRouter,
});

export type AppRouter = typeof appRouter;
