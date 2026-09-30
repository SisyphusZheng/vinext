import { PushOnMount } from "./push-on-mount";

export default function RefreshDuringNavigationRedirectPushPage() {
  return (
    <>
      <h1 id="redirect-push-page">Redirect push</h1>
      <PushOnMount />
    </>
  );
}
