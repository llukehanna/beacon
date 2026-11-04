import { Suspense, lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import Titled from "@/Titled";
import Loading from "@/components/Loading";
import Home from "@/desk/Home";

// Home is the start-of-day page and stays in the initial bundle. Every other
// surface is split into its own chunk and fetched on first navigation.
const Accuracy = lazy(() => import("@/desk/Accuracy"));
const Desk = lazy(() => import("@/desk/Desk"));
const MandatePage = lazy(() => import("@/desk/MandatePage"));
const Pipeline = lazy(() => import("@/desk/Pipeline"));
const Review = lazy(() => import("@/desk/Review"));
const Rules = lazy(() => import("@/desk/Rules"));
const SearchPage = lazy(() => import("@/desk/SearchPage"));

export const router = createBrowserRouter(
  [
    {
      // Start-of-day operations page. Every card and number on it links to
      // the surface that does the work; it is not a stats dashboard.
      path: "/",
      element: (
        <Titled title="Beacon — Home">
          <Home />
        </Titled>
      ),
    },
    {
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
  { basename: import.meta.env.BASE_URL },
);
