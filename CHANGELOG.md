# Changelog

## [1.1.0-beta](https://github.com/ethnjs/nexus/compare/v1.0.0-beta...v1.1.0-beta) (2026-09-17)


### Features

* **admin:** add an owner profile panel and badge-based cells ([59935da](https://github.com/ethnjs/nexus/commit/59935dae1ae485f25efa36c5c2d3495a0c3d806b))
* **admin:** add the accounts table with a profile panel and row actions ([3273c95](https://github.com/ethnjs/nexus/commit/3273c9583a7ffc4514ff2c2ba1289964cd5b2271))
* **admin:** add the admin tournaments table ([ef1e8a6](https://github.com/ethnjs/nexus/commit/ef1e8a6fcd31a2ba69541201c2537f81540ccce1))
* **admin:** add the catalog table, categories modal, and season grid ([6670ae7](https://github.com/ethnjs/nexus/commit/6670ae7be09aaa65dbc630fa822af11fd2b1c9e4))
* **admin:** add the universities table  with inline editing ([54b3b58](https://github.com/ethnjs/nexus/commit/54b3b585b1142266e3f44dafbd90ae02816d6209))
* **admin:** extract a generic sidebar and add the flat admin rail ([ee9f44a](https://github.com/ethnjs/nexus/commit/ee9f44a5675ef5a4537ab37624453769df887236))
* **admin:** merge the event tabs into a season picker and stage season adds ([2679302](https://github.com/ethnjs/nexus/commit/26793027e5b6f2037a462bb0ef6fc1426bb6be88))
* **admin:** open the panel from anywhere in a row and add step arrows ([ac944d0](https://github.com/ethnjs/nexus/commit/ac944d081c480aaf2df8a69515ecd6c9ac1e329d))
* **admin:** toast the outcome of every change ([6ce9cb6](https://github.com/ethnjs/nexus/commit/6ce9cb6c5d54773734919eba769f93c6c6d457a3))
* **auth:** add admin-triggered password reset route ([2283dc0](https://github.com/ethnjs/nexus/commit/2283dc01759bf318b38dec0d10e4a39686db9678))
* **auth:** carry owner and aggregate counts on the admin tournament list ([5f6d37b](https://github.com/ethnjs/nexus/commit/5f6d37b21cd0001004324aa81e6b86017d295aa1))
* **auth:** guard admins against demoting, deactivating, or deleting themselves ([47ffb7f](https://github.com/ethnjs/nexus/commit/47ffb7f67ad29f6b02727c68456fe74e579e07ec))
* platform admin dashboard ([37a1152](https://github.com/ethnjs/nexus/commit/37a11525daf0ccd14623225c5097de062a76e7a8))
* **profile:** add a header badges slot for admin account state ([5d14603](https://github.com/ethnjs/nexus/commit/5d14603409bf0a5fdc8ad913e8c138ced137c754))
* **profile:** add guarded back navigation to the profile edit page ([0280eb1](https://github.com/ethnjs/nexus/commit/0280eb1584d40c67b94e63d6316e1a36f1aae796))
* **profile:** let admins view any profile and show account badges ([2662e4f](https://github.com/ethnjs/nexus/commit/2662e4f7e8e598fcf7967289c207ff328d95d29b))
* **ui:** replace the shield icon with a solid shield and knocked-out check ([852bcd8](https://github.com/ethnjs/nexus/commit/852bcd8aa3bca954df2ebd082b2851ca0f644191))


### Bug Fixes

* **admin:** only render the nav rail for admins ([334884a](https://github.com/ethnjs/nexus/commit/334884a59149de5799d69b579eea00cdb8566ce3))
* **admin:** stop dimming archived tournament rows so actions read as available ([3ea85ec](https://github.com/ethnjs/nexus/commit/3ea85ec93913087bfdca6cb2c0e6cbafdda41bb2))
* **admin:** stop dimming locked rows so actions read as available ([7b9a6f7](https://github.com/ethnjs/nexus/commit/7b9a6f766ae001ed8746d9da0984ac89c129052e))
* **auth:** fit the sign-in card to the dynamic viewport on mobile ([b303188](https://github.com/ethnjs/nexus/commit/b3031889735de6a769355aad19d23e23fe5c7088))
* **auth:** let an admin delete an archived tournament ([e98231e](https://github.com/ethnjs/nexus/commit/e98231e7008ca05713c0b2eae6e66df79c65dcc7))
* **auth:** revoke sessions when an admin moves a user off active status ([47c579a](https://github.com/ethnjs/nexus/commit/47c579ab3c6b68b6d9e2ad0acd45778b2af24f13))
* **forms:** fit the respondent form flows to a phone viewport ([9d0fc2d](https://github.com/ethnjs/nexus/commit/9d0fc2de50a6576bc424e3765427a70d17950a9d))
* **forms:** let a long-press start a ranked-list drag so touch scrolling still works ([00c65dc](https://github.com/ethnjs/nexus/commit/00c65dccf7a7937c3548162c05c9c865f6d0f0dc))
* mobile layout for the volunteer flow ([49c23cd](https://github.com/ethnjs/nexus/commit/49c23cdca44443ca0020a69571bf14d9e4ce152e))
* **onboarding:** fit the account onboarding page to a phone viewport ([b0b17bb](https://github.com/ethnjs/nexus/commit/b0b17bb92836f14738480ddbea159984ef9ad87b))
* **onboarding:** mark every gating question as required ([97c76ed](https://github.com/ethnjs/nexus/commit/97c76eda90d5d408eb6ec7a452b431c4112b7ac8))
* **onboarding:** show the avatar with a sign-out-only menu ([71d4afd](https://github.com/ethnjs/nexus/commit/71d4afd9b0d318743ae7e6ea36aa32d63f693e94))
* **overview:** stack the overview widgets on mobile ([b5bbf6a](https://github.com/ethnjs/nexus/commit/b5bbf6a44ee9965668fd72253e2f23d5c42b56de))
* **profile:** restore side padding on the mobile profile pages ([9534407](https://github.com/ethnjs/nexus/commit/95344070a50af78889d62dec6682b11cbf7ca9b8))
* **profile:** stack the experience tables into cards and reflow the profile pages on mobile ([5d7d170](https://github.com/ethnjs/nexus/commit/5d7d170b20ee7c864aae7c714ed6a094e3949ce8))
* **roles:** use one rank-lock reason everywhere instead of a misleading self-specific message ([2fa169f](https://github.com/ethnjs/nexus/commit/2fa169f2889c2b6037fa7c8bfe45a2f8e37023cc))
* **settings:** stack the account rows and move the nav to a media query for mobile ([a1f3aed](https://github.com/ethnjs/nexus/commit/a1f3aed57e24dad4d8c8a31e9285850a4e605f75))
* **tournaments:** put the year on each run when dates span multiple years ([80cb6f5](https://github.com/ethnjs/nexus/commit/80cb6f5a021842820981d472bd9f3d56ae487d78))
* **ui:** float tooltips above overflow-clipped containers and even out locked chip padding ([79321e0](https://github.com/ethnjs/nexus/commit/79321e0a4d0982a86d52cd71a38f835b0e03f00e))
* **ui:** floor text control font size at 16px on mobile to stop iOS zoom ([3375857](https://github.com/ethnjs/nexus/commit/33758570c897df15fb7bf6960b79122f0400bfb8))
* **ui:** grow mobile text controls to match the 16px font floor ([4134397](https://github.com/ethnjs/nexus/commit/41343977d568ec705f18cb38c553df8184f0e957))
* **ui:** hide open group's subitems when the sidebar rail is collapsed ([4233057](https://github.com/ethnjs/nexus/commit/4233057e349ad18e44e5fbf2e90294ad00165e67))
* **ui:** keep tooltips inside the viewport on narrow screens ([c804790](https://github.com/ethnjs/nexus/commit/c804790d65629c303d69688731bf0ce4030359f5))
* **ui:** match the dropdown footer's padding to the option rows and clear the option highlight when hovering the footer ([bdaeb4b](https://github.com/ethnjs/nexus/commit/bdaeb4b8e177e5fa5b07cf60b0aa7d2ce0c4727e))
* **ui:** merge caller style overrides in Input instead of replacing the computed style ([cccd066](https://github.com/ethnjs/nexus/commit/cccd066d15420c559f61af5a94d864af40d95e68))
* **ui:** move the mobile nav toggle into the topbar so it stays attached on overscroll ([fcb2957](https://github.com/ethnjs/nexus/commit/fcb2957551eccaac49fe8618d3a460a811514a63))
* **ui:** size the hero on the home page to the dynamic viewport so the nav island stays visible ([fad2d7f](https://github.com/ethnjs/nexus/commit/fad2d7f20ad1858ea57be839516ac7419eaa7c0e))
* **ui:** stop the PageHeader action overflowing its card and stack it on mobile ([1f9f7a1](https://github.com/ethnjs/nexus/commit/1f9f7a11495302b039222176fcbcf4c0a2641628))
* **ui:** stop the topbar wordmark shifting when the mobile drawer opens ([b788b0e](https://github.com/ethnjs/nexus/commit/b788b0e2474183645a5644abff52a986b353cbf0))
* **ui:** switch the app shell to a nav drawer below 640px for mobile screens ([b1feaa6](https://github.com/ethnjs/nexus/commit/b1feaa654c21ef5ab604ad37c9c4f11ba23c5863))
* **ui:** use a small secondary Button for the mobile nav toggle ([d4114da](https://github.com/ethnjs/nexus/commit/d4114da5a2c1992a43a2d0da2c63cde921426793))
* **ui:** wrap banner content on mobile instead of pushing it past the border ([6953af3](https://github.com/ethnjs/nexus/commit/6953af3426068c30fcf706a868d166cda90872dc))
* **ui:** wrap ButtonGroup options instead of overflowing the container ([15ea11a](https://github.com/ethnjs/nexus/commit/15ea11a7832bf1753d174ef803de681822646aa6))
* **universities:** block deletion of a university that a tournament track still references ([54e7111](https://github.com/ethnjs/nexus/commit/54e7111b5e41a587eb2938f34b93da10f9c4159d))


### Reverts

* **ui:** drop the 16px mobile font floor on text controls ([618508c](https://github.com/ethnjs/nexus/commit/618508cd7dae00e3721f8fb2e3f6f575332b7c90))
