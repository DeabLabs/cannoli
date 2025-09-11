# Setting up your environment

## Pre-requisites

- nvm
  - Manage node versions
  - <https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating>
- obsidian

  - Choose a vault you'd like to do development in
    - It is recommended to create a new vault for development, that does not already have cannoli installed
  - Install hot-reload plugin

    - <https://github.com/pjeby/hot-reload?tab=readme-ov-file#installation>

    - `cd <my_obsidian_vault>/.obsidian/plugins && git clone git@github.com:pjeby/hot-reload.git`

    - Make sure to enable it in obsidian once installed

- VSCode (optional)
  - Any VSCode (or descendant) editor will pick up common configuration from the cannoli repo
  - Code formatting settings and recommended extensions for cannoli development will appear when opening cannoli inside of one of these editors

## Building your dev environment

```bash
# navigate to your obsidian vault's plugin folder
cd <my_obsidian_vault>/.obsidian/plugins
# create a fork of this repo, then clone it
# replace the url here with your own fork's url
git clone git@github.com:DeabLabs/cannoli.git
cd cannoli
# install and use this repo's version of npm
nvm install
nvm use
# install pnpm
npm i -g pnpm
# from here on we will use pnpm exclusively
# it manages cannoli's monorepo
# lets install the dependencies next
pnpm install
# now we have all dependencies for the cannoli monorepo, and the cannoli-core and cannoli-plugin packages
# lets build the plugin so that it can be enabled in obsidian
pnpm build
# you should be able to enable and use your development version of the plugin in obsidian now!
```

## Development workflow

### Making code changes and seeing them live in obsidian

```bash
# open up a terminal inside of the cannoli monorepo root directory
# this can typically be done quickly by opening the repo in your editor and then opening a terminal
# install up to date dependencies, in case any have changed
pnpm install
# now lets kickoff the dev script
pnpm run dev
# this builds cannoli-core, cannoli-plugin, and then emits their files in the root of the monorepo
# once the files appear/update, the hot-reload plugin will immediately refresh the cannoli plugin within obsidian
# finally, any changes that occur to any file in the repo will trigger an automatic rebuild as long as the dev command continues to run
# so you can make a change to a file, save it, and see it appear in obsidian in typically less than one second
```

## Deploying a new version of cannoli-server

```bash
pnpm changeset
# select cannoli-server with spacebar and enter
# chose major, minor, or patch
# describe the changes
# when merged into main, a PR will be opened that will trigger a new release of cannoli-server when merged
```
