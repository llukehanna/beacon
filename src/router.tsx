import { Suspense, lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import RouteError from "@/RouteError";
import Titled from "@/Titled";
import Loading from "@/components/Loading";
import Home from "@/home/HomePage";
import AppShell from "@/shell/AppShell";

// Home is the start-of-day page and stays in the initial bundle. Every other
// surface is split into its own chunk and fetched on first navigation.
const Accuracy = lazy(() => import("@/desk/Accuracy"));
const Desk = lazy(() => import("@/desk/firmDesk/DeskPage"));
const MandatePage = lazy(() => import("@/desk/MandatePage"));
const Pipeline = lazy(() => import("@/desk/Pipeline"));
const Review = lazy(() => import("@/desk/Review"));
const Rules = lazy(() => import("@/desk/Rules"));
const SearchPage = lazy(() => import("@/desk/SearchPage"));

export const router = createBrowserRouter(
  [
    {
      // One layout route: the shell (sidebar, top bar, status bar) stays mounted while the
      // screens below it come and go.
      element: <AppShell />,
      children: [
        {
          // Start-of-day operations page. Every card and number on it links to
          // the surface that does the work; it is not a stats dashboard.
          errorElement: <RouteError />,
          path: "/",
          element: (
            <Titled title="Beacon — Home">
              <Home />
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/desk",
          element: (
            <Titled title="Beacon — Enrichment Desk">
              <Suspense fallback={<Loading />}>
                <Desk />
              </Suspense>
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/pipeline",
          element: (
            <Titled title="Beacon — Pipeline">
              <Suspense fallback={<Loading />}>
                <Pipeline />
              </Suspense>
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/review",
          element: (
            <Titled title="Beacon — Review">
              <Suspense fallback={<Loading />}>
                <Review />
              </Suspense>
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/rules",
          element: (
            <Titled title="Beacon — Rules">
              <Suspense fallback={<Loading />}>
                <Rules />
              </Suspense>
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/accuracy",
          element: (
            <Titled title="Beacon — Accuracy">
              <Suspense fallback={<Loading />}>
                <Accuracy />
              </Suspense>
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/mandate",
          element: (
            <Titled title="Beacon — Mandates">
              <Suspense fallback={<Loading />}>
                <MandatePage />
              </Suspense>
            </Titled>
          ),
        },
        {
          // "Interpret & run search" surface — turns a mandate's intent into
          // a Search (geographies / industries / seeds / exclusions / breadth
          // → the run-search action). Routes to /desk?search=<id> on completion.
          errorElement: <RouteError />,
          path: "/search/:mandateId",
          element: (
            <Titled title="Beacon — Run search">
              <Suspense fallback={<Loading />}>
                <SearchPage />
              </Suspense>
            </Titled>
          ),
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
