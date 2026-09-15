# gifselector

gifselector is a small self-hosted web app for keeping your own collection of GIFs, sorting them into categories, and sharing individual ones by link.
You log in as the admin, drop GIF or WebP files onto the page or import them from a URL, and hand out share links that point straight at the animated file.
An optional Discord bot brings the same importer into a server you invite it to, where a GIF you post is saved to your collection and answered with its link.
The React front end and the Express back end live in one package, are built together, and are served by a single process on one port.

## Running it

The docker-compose.yml in the repository root pulls the published image from ghcr.io and mounts ./data at /data.
Set ADMIN_PASSWORD and JWT_SECRET in that file to real values and bring it up:

```sh
docker compose up -d
```

To build and run the image yourself, mount a directory at /data and pass the same two variables:

```sh
docker build -t gifselector .
docker run -p 3000:3000 -v "$(pwd)/data:/data" -e ADMIN_PASSWORD={password} -e JWT_SECRET={secret} gifselector
```

The server refuses to start in production while either of those is still at its built-in default.
Before the app launches, the container runs a short preflight that checks /data is writable by the unprivileged user it runs as and prints the configuration it picked up, so a host problem such as mount ownership shows up in the logs along with the command that fixes it.

Everything the app stores sits in that one directory, with the SQLite database as gifselector.db and the files in an uploads folder beside it, so the /data volume is all there is to back up.
Outside the container, and without NODE_ENV set to production, it uses a data folder in the project instead.

To serve the app behind a reverse proxy under a subpath, set BASE_PATH to that prefix, for example /gifselector, and the pages, the api and the share links all move under it.

## Configuration

Settings come from environment variables, and for a local run the server also reads a .env file.
The .env.example in the repository lists every variable with its default value.

| Variable                          | What it does                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PORT                              | The port the server listens on.                                                                                                                                                                                               |
| BASE_PATH                         | The subpath the app, its api and its share links are served from. Empty or / serves from the root.                                                                                                                           |
| TRUST_PROXY                       | How far to trust X-Forwarded-For when working out the client address that the login lockout and rate limiter key on. Set it to 1 behind a single reverse proxy, or a higher number for a longer chain. Unset trusts nothing. |
| ADMIN_USERNAME                    | The login username.                                                                                                                                                                                                           |
| ADMIN_PASSWORD                    | The login password. The server refuses to start in production with the default.                                                                                                                                               |
| JWT_SECRET                        | The secret that signs session cookies. The server refuses to start in production with the default.                                                                                                                            |
| LOG_TO_FILE                       | Set to 1 or true to write access.log and hourly access statistics into the data directory.                                                                                                                                    |
| GIFS_PUBLIC_ORIGIN                | The origin share links are built from, for example https://gifs.example.com. Unset builds them from the request's Host header.                                                                                                |
| GIFS_PUBLIC_CATEGORY              | The name of a category to show read only under /public to visitors who are not logged in. Unset keeps the public gallery closed.                                                                                              |
| GIFS_DEFAULT_CATEGORY_ID          | The id of the category the gallery opens on. Unset opens on the whole collection.                                                                                                                                             |
| GIFS_ALLOWED_DOMAINS              | The comma separated hosts the URL importer may download from, where a subdomain of a listed host counts too. Empty uses the built-in list.                                                                                    |
| GIFS_MAX_FILE_SIZE_MB             | The largest file in megabytes an upload or import may produce. The importer rejects a download once its advertised or actual size passes this.                                                                                |
| GIFS_MAX_MEGAPIXELS               | The decoded pixel budget, width times height summed across every frame, which catches a small file that expands into an enormous canvas.                                                                                     |
| GIFS_MEDIA_TIMEOUT_SECONDS        | How long gallery-dl, ffmpeg or any ImageMagick call may run before it is killed.                                                                                                                                              |
| DISCORD_BOT_TOKEN                 | The bot token from the Discord developer portal. The bot starts only when it is set.                                                                                                                                          |
| DISCORD_ALLOWED_USER_IDS          | The comma separated Discord user ids allowed to import through the bot. Empty ignores everyone.                                                                                                                               |
| DISCORD_CHANNEL_IDS               | The comma separated channel ids the bot answers in. Empty answers in every channel and direct message.                                                                                                                        |
| DISCORD_PUBLIC_ORIGIN             | The origin the bot builds share links from, for example https://gifs.example.com. Unset points its links at localhost.                                                                                                        |
| DISCORD_RATE_LIMIT_MAX            | How many GIFs one Discord user may import per window. Anything over that is skipped, and the reply says when the window resets.                                                                                               |
| DISCORD_RATE_LIMIT_WINDOW_MINUTES | The length of that window in minutes.                                                                                                                                                                                         |
| PREFLIGHT_NET_CHECK               | Set to 1 to have the container preflight also test outbound DNS and TCP.                                                                                                                                                      |

## The Discord bot

The bot reads ordinary messages rather than slash commands, so a GIF you post where it can see it, as an attachment or a link, is imported and answered with its share link.
Reading messages that way decides how it has to be set up.

On the [Discord developer portal](https://discord.com/developers/applications), create an application, add a bot to it, and enable the Message Content Intent under Privileged Gateway Intents.
Discord hides message text from a bot without that intent, which leaves pasted links invisible and only attachments coming through.

The bot then has to join a server as a member.
Build the invite under OAuth2 with the URL generator, tick the bot scope, and grant View Channels, Send Messages, Read Message History and Add Reactions.
The install link on the application's own page installs the app against your account and leaves it out of every server, so use the URL generator for the invite.
Once it is in a server you can post in any channel it can see, or message it directly from its profile.

Put the token in DISCORD_BOT_TOKEN, your own user id in DISCORD_ALLOWED_USER_IDS, and your instance's public origin in DISCORD_PUBLIC_ORIGIN so the links it replies with point back at you.
With DISCORD_CHANNEL_IDS filled in, the bot answers only in those channels, and that applies to direct messages as well.

Each message from an allowed user is scanned for GIF, WebP and MP4 attachments and for links.
Attachments are imported directly, links go through the same domain allowlist as the web importer, and MP4s are converted to WebP as they are on the site.

## Development

The mise.toml pins Node 26 and pnpm, and uploads and imports need ImageMagick and ffmpeg on the PATH, with gallery-dl used by the importer when it is present.
Install the dependencies and start the API and the front end together:

```sh
pnpm install
pnpm dev
```

That runs the API under a file watcher on port 3000 next to the Vite dev server, which proxies /api and /share to it.
CI runs pnpm lint, pnpm fmt:check, pnpm typecheck, pnpm test and pnpm build, and the Playwright end to end suite runs with pnpm e2e.

## License

gifselector is released under the GNU General Public License v2.0, see LICENSE.
