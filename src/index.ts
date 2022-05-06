import 'source-map-support/register.js';
import { program } from 'commander';
import { argv } from 'process';
import DiscordOauth2, { TokenRequestResult } from "discord-oauth2";
import { JSONFile, Low } from 'lowdb';
import express, { Express, Request, Response } from 'express';

program
    .name('backupmembers')
    .version('1.0.0')

program
    .command("api")
    .description("Run the api server")

    .action(async () => {
        const config = (await import('./config.js')).default;

        const api = new API(config.clientId, config.clientSecret, config.redirectUri, config.botToken);
        await api.start();
    });

program
    .command("transfer <id>")
    .description("Transfer all members to another guild")
    .action(async (newGuildId) => {
        const config = (await import('./config.js')).default;

        const api = new API(config.clientId, config.clientSecret, config.redirectUri, config.botToken);
        await api.transfer(newGuildId);
    });

program.parse(argv);


type Data = {
    tokens: {
        [key: string]: TokenRequestResult
    }
    refreshAt: {
        [key: string]: number;
    }
}

export class API {
    private oauth: DiscordOauth2;
    private db: Low<Data>;

    private clientId: string;
    private clientSecret: string;
    private redirectUri: string;
    private botToken: string;
    private newGuildId?: string;

    constructor(clientId: string, clientSecret: string, redirectUri: string, botToken: string, newGuildId?: string) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
        this.botToken = botToken;
        this.newGuildId = newGuildId;

        this.oauth = new DiscordOauth2({
            clientId: this.clientId,
            clientSecret: this.clientSecret,
            redirectUri: this.redirectUri,
        });

        const adapter = new JSONFile<Data>('api.json');
        this.db = new Low(adapter);
    }

    private async initDatabase() {
        await this.db.read();
        this.db.data ||= { tokens: {}, refreshAt: {} };
    }


    public async start() {
        await this.initDatabase();

        const app: Express = express();
        const port = 8080;

        app.get("/callback", async (req: Request, res: Response) => {
            try {
                this.db.data ||= { tokens: {}, refreshAt: {} };
                const code = req.query.code;
                if(!code) {
                    res.send("No code provided");
                    return;
                }
                const tokenRequest = await this.oauth.tokenRequest({
                    scope: ["identify", "guilds.join", "guilds"],
                    code: code.toString(),
                    grantType: "authorization_code",
                })
    
                const user = await this.oauth.getUser(tokenRequest.access_token);
                const userId = user.id;
    
                this.db.data.tokens[userId] = tokenRequest;
                this.db.data.refreshAt[userId] = Date.now() + (tokenRequest.expires_in * 1000);
                await this.db.write();
                res.send("You have been registered to be transferred to a new guild in the future.");
            } catch (error) {
                res.sendStatus(400);
                console.error(error);
            }
        });

        app.listen({port}, () => {
            console.log(`Server listening on port ${port}`);
        });
    }

    public async transfer(newGuildId: string) {
        await this.db.read();
        const refreshTokens = this.db.data!.tokens;
        const refreshAt = this.db.data!.refreshAt;

        let count = 0;
        let failed = 0;

        for(const userId in refreshTokens) {
            try {
                let token = refreshTokens[userId];
                
                if(refreshAt[userId] < Date.now()) {
                    token = await this.oauth.tokenRequest({
                        scope: ["identify", "guilds.join", "guilds"],
                        grantType: "refresh_token",
                        refreshToken: token.refresh_token,
                    })
                    this.db.data!.tokens[userId] = token;
                    this.db.data!.refreshAt[userId] = Date.now() + (token.expires_in * 1000);
                    await this.db.write();
                }

                const user = await this.oauth.getUser(token.access_token);

    
                await this.oauth.addMember({
                    accessToken: token.access_token,
                    guildId: newGuildId,
                    userId: user.id,
                    botToken: this.botToken,
                });
            } catch (ignored) {
                failed++;
                continue;
            }
            
            count++;
        }

        const timer = setInterval(async () => {
            //show precentage of users transferred
            console.log(`${count} users transferred, ${failed} failed`);
            if(count+failed === Object.keys(refreshTokens).length) {
                clearInterval(timer);
                console.log(`Transferred ${count} users.`);
                console.log(`Failed to transfer ${failed} users.`);
            }
        }, 1000);
    }
};