import {FunctionComponent} from "preact";
import Router from "preact-router";
import {Register} from "./pages/Register";
import {Login} from "./pages/Login";
import {Redirect} from "./components/Redirect";
import {Page} from "./components/Page";
import {WebAuthNContextProvider} from "./providers/WebAuthNProvider";
import {ConfigContextProvider} from "./providers/ConfigProvider";
import {EthereumContextProvider} from "./providers/EthereumProvider";

export const App: FunctionComponent = () => {
  return (
    <ConfigContextProvider>
      <EthereumContextProvider>
        <WebAuthNContextProvider>
          <Page>
            <Router>
              <Register path="/register"/>
              <Login path="/login"/>
              <Redirect path="/" to="/register"/>
            </Router>
          </Page>
        </WebAuthNContextProvider>
      </EthereumContextProvider>
    </ConfigContextProvider>
  )
}
