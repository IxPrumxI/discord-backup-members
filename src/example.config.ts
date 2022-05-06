
export interface Config {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    botToken: string;
}

const bot: Config = {
    "clientId": "id",
    "clientSecret": "secret",
    "redirectUri": "http://localhost/callback",
    "botToken": "token"
}

export default bot;