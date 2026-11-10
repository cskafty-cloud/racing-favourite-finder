const { app, BrowserWindow, shell, dialog } = require("electron");

const APP_URL = "https://racing-favourite-finder-production.up.railway.app";
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: "Racing Favourite Finder",
    backgroundColor: "#080d18",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(APP_URL).catch(() => {
    dialog.showMessageBox(win, {
      type: "warning",
      title: "Connection required",
      message: "Racing Favourite Finder needs an internet connection.",
      detail: "Reconnect to the internet and restart the app. Live races, sports and market data are provided by the online website."
    });
  });
}

app.whenReady().then(() => {
  const choice = dialog.showMessageBoxSync({
    type: "info",
    title: "Racing Favourite Finder",
    message: "Internet connection required",
    detail: "This app connects to the live Racing Favourite Finder website to display racing and sports information. It is an information-only app: it does not place bets or connect to bookmaker accounts.",
    buttons: ["Continue", "Exit"],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (choice !== 0) {
    app.quit();
    return;
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
