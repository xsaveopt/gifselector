# gifselector

gifselector is a small self-hosted web app for keeping your own collection of GIFs, sorting them into categories, and sharing individual ones by link.
You log in as the admin, drag GIFs in or import them from a URL, and hand out share links that point straight at the animated file.
An optional Discord bot brings the same importer into chat: send it a GIF and it saves the file to your collection and replies with the link.

It is one project.
A React front end and an Express back end live in the same package, build together, and are served by the same process on a single port.

## Contents

- [Running it](#running-it)
- [Configuration](#configuration)
- [The Discord bot](#the-discord-bot)
- [Development](#development)
- [Storage](#storage)

## Running it

The quickest way to run gifselector is the docker-compose.yml in the repository root.
It pulls the published image and mounts a ./data volume for you, so fill in ADMIN_PASSWORD and JWT_SECRET in that file and bring it up:

```sh
docker compose up -d
```

You can also drive the image yourself.
Build it from the repository root:

```sh
docker build -t gifselector .
```

Then run it with a volume mounted at /data so your database and uploads survive restarts, and with the admin password and signing secret set:

```sh
docker run -p 3000:3000 \
  -v $(pwd)/data:/data \
  -e ADMIN_PASSWORD=change-me \
  -e JWT_SECRET=some-long-random-string \
  gifselector
```

The server refuses to start in production while the admin password or the JWT secret is still at its default, so set both to real values.
At startup it also runs a short preflight that confirms the /data mount is writable and prints the configuration it resolved, so when something on the host is misconfigured the container logs tell you what is wrong and how to fix it.

By default the app is served from the root path.
If you put it behind a reverse proxy under a subpath, set BASE_PATH to that prefix, for example /gifselector, and the server serves the whole app, its API, and its share links from there.

## Configuration

Everything is configured through environment variables, and for a local run you can copy .env.example to .env instead of passing each one with -e.
Here is each variable, what it does, and the value it falls back to:

| Variable                 | Default       | What it does                                                                                                                                                                                                            |
| ------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PORT                     | 3000          | The port the server listens on.                                                                                                                                                                                         |
| BASE_PATH                | / (root)      | The subpath the app and its share links are served from.                                                                                                                                                                |
| TRUST_PROXY              | off           | How far to trust X-Forwarded-For headers when working out the client address that the login lockout and rate limiter key on. Set it to 1 behind a single reverse proxy, or a higher number for a longer chain.          |
| ADMIN_USERNAME           | admin         | The login username.                                                                                                                                                                                                     |
| ADMIN_PASSWORD           | change-me     | The login password. The server refuses to start with the default in production.                                                                                                                                         |
| JWT_SECRET               | placeholder   | The secret that signs session cookies. The server refuses to start with the default in production.                                                                                                                      |
| LOG_TO_FILE              | off           | Set to 1 to write an access log and periodic access statistics into the data directory.                                                                                                                                 |
| GIFS_PUBLIC_CATEGORY     | unset         | A category to expose read only under /public for people who are not logged in. Unset keeps the public gallery closed.                                                                                                   |
| GIFS_DEFAULT_CATEGORY_ID | unset         | The category the gallery opens on. Unset opens on the whole collection.                                                                                                                                                 |
| GIFS_ALLOWED_DOMAINS     | built-in list | The comma separated hosts the URL importer may download from, with a subdomain of any listed host counting too. Defaults to tenor.com, giphy.com, klipy.com, imgur.com, discord.com, discordapp.com and discordapp.net. |
| DISCORD_BOT_TOKEN        | empty         | The bot token from the Discord developer portal. The bot starts only once it is set.                                                                                                                                    |
| DISCORD_ALLOWED_USER_IDS | empty         | The comma separated Discord user ids allowed to import through the bot. Empty ignores everyone.                                                                                                                         |
| DISCORD_CHANNEL_IDS      | empty         | The comma separated channels the bot listens in. Empty answers in any channel or direct message.                                                                                                                        |
| DISCORD_PUBLIC_ORIGIN    | empty         | The public origin the bot builds share links from, for example https://gifs.example.com.                                                                                                                                |

## The Discord bot

The bot takes the URL importer into Discord, so a GIF you send it, whether as an attachment or a link, is saved to your collection and answered with its share link.

To set it up, create an application on the [Discord developer portal](https://discord.com/developers/applications), add a bot to it, and enable the Message Content Intent under Privileged Gateway Intents.
Put the bot token in DISCORD_BOT_TOKEN, your own Discord user id in DISCORD_ALLOWED_USER_IDS, and your instance's public origin in DISCORD_PUBLIC_ORIGIN so the links it replies with point back at you, for example https://gifs.example.com.
The bot only starts when a token is present, and with the allowed user list empty it ignores everyone, which is the safe default.
DISCORD_CHANNEL_IDS optionally restricts it to specific channels, and left empty it answers in any channel or direct message.

Once it is running, every message from an allowed user is scanned for GIF, WebP, and MP4 attachments and links.
Attachments are imported directly, links go through the same domain allowlist as the web importer, and MP4s are converted to WebP just as they are on the site.

## Development

You need Node 26 or newer and pnpm.
Install the dependencies and start both halves at once with:

```sh
pnpm install
pnpm dev
```

That runs the API under a file watcher alongside the Vite dev server, and the front end proxies its /api and /share requests to the API on port 3000.
Before pushing, the same checks CI runs are available as pnpm lint, pnpm fmt:check, pnpm typecheck, pnpm test, and pnpm build, and the Playwright end to end suite runs with pnpm e2e.

## Storage

The app keeps everything under a single directory, which is /data inside the container.
The SQLite database lives there as gifselector.db and the uploaded files sit in an uploads folder beside it, so mounting one volume at /data is enough to persist the whole collection.
Running locally without the container, it uses a data folder in the project instead.

If you are moving from an older layout that kept the database and uploads in separate places, put gifselector.db and the uploads folder together inside the directory you mount at /data.
The database format has not changed, so the file carries over as is.
