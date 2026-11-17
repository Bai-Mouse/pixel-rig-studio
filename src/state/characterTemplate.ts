import type { AnimationFrame, NodeFrameState, ProjectSettings, RigNode, SpriteAsset, SpriteSource } from '../types/project';

/**
 * Default character template: the rig structure and first-frame pose of the 知更鸟 project,
 * textured by slicing the bundled Character Sheet.png with the same sprite rectangles.
 * Sprite parts that are not drawn on the sheet yet stay in the rig as empty placeholders.
 */

const sheetSrc =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAYAAACLz2ctAAAAAXNSR0IArs4c6QAABFlJREFUeJzt3T1OJEcYBuAPy7LICGZDDxI5ARs4IcFnwAdAGxA7RZyAFIkcOSBkD2BtYBMgayMC5ANA4oAEObE2GQd48YBm+qeme6preB4JMWrR3fPz8nV3VXVNBDAck8f7yeTxftL3OjxZy/0EhuR1iNY2xrXvT8o6/O+b3E9gKLqqYCphO/5b54SmTSVbdP237M2/SV2FRwjTOAS/khoaYUsjgFMWDZEQAgBAveST5nkNrk7EaaOT9q6ZGxZEGmgVkrbdTEJIHe2AZLVQf2ejHRRWBadfZ9vRMKW91iFQAacsOpLFSJj2BPA/hmPl8eYPwV00J2mSSvdtykqb27vPj+9ur2uXl6ZtcNY2xmsqX5qkQ/DW2WHc3V7H1tlho+UlMRxruZIq4HjvfcTN+tPvBsuHrMvgCGF7GqLJSlccWRmMQFa9VEAhpKnezgGFkCZ6bYgWQuroiiOrRhVqkVZ+VZAqSRXw1z/+bPy3uqio0nr2p0js+xxqJTQvTF6VFbDqzW37JquEzDI3gH38Zwshr80MYJPw1YVpbWO8NiuwZhNl2osAzgtH2/BVrQvTaq+CuwiQEDJP5XjAeYfQJhuePN5PptcXQmZ5EUAhMRx/2XTFkZUAkpUATnFD0vL1NiQ/ev5gfEHMauitAi4zfPOWMXytA5i70lQFTQjLU9Q5YJOACWFZigpgU0JYjqSZEerkPky31cUcf+YJTFNUBfTBrp6kAFYFoe+Q9L39lMO3Q366oipgY3//pVIWosgAOhSvjiIDWEU4y5J0FTyEc57K89Dvf1juk4mIhy/r8e67f5a+39KtXAVM9fHT5+R1H76sx9XV1ULbeKt6aQcszcdPn2NnZ+f5cVtXV1cxHo9jNBoJYUsCGBEXFxdxcXERERFHR0et1x+Px3FyctLDM1t9nR+Ch3B+2Mb+/v4kIuLhYCcuz09jNBq13sZoNIrL89N4ONh5sU3qLdztNHOjBV2Jfn0tP334OR4OduL3Hz8kzfqw99t5vPvlJi7PTyMKew9yevMBJK9eroJLOwyTj2YYshJAAAAAgKUossdCT8zqKK4dUC/LaikugKyWog5VQ5mZi+6ogGQlgGQlgGQlgGQlgGQlgAAAAAAAANCLhQZtzhsgajAoTfUyPdvzxgWRGr1+YXUIITWMhiGr1lPRJu1EFWQOFZCsBJCsBJCskr+oZnN79/nx3e117XKYJbkCbp0dxt3tdWydHTZaDrMkB3C89z7iZv3pd4PlMIuGaLLSFQcAAAAAAAAAAAAMxvHxsa9xLZC74gAgi4Xv2cg5R2DVvSnuRylD8oeU88Yk35y+Onq9K+55Jx2GIGWGLiEcLlfBZNU6gCkVKHVewb62w3CogGQlgGQlgGTVSQA3t3eff14vzyn3/qnXSQCr5grM6ev+XbwMVycBrJwrsENt2/PMUTh8S2mIjsyN0Rqih6v3rrjI3B0nfAAAAAAAAAAAAAAAAAAAAFCwfwHuY+bmMUwU8AAAAABJRU5ErkJggg==';

const sheetSource: SpriteSource = {
  id: 'character-template-sheet',
  name: 'Character Sheet.png',
  src: sheetSrc,
  width: 160,
  height: 160,
};

interface PartDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  src: string;
  slice: { x: number; y: number };
}

const parts: PartDefinition[] = [
  { id: 'asset-5c16cd8f-d43c-4164-8c7c-a61fa4cd8b4a', name: "爱芮_part_10.png", width: 13, height: 11, slice: { x: 43, y: 43 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA0AAAALCAYAAACksgdhAAAAUElEQVR4nGNkQAL/Pz7+j8xn5JdlZMACmHBpwCUG1/QfhyQuOSZ8GmAAXQ3ceaRoJFoTMmDCFUIMeADYJlI1Eu+8zy/gBsM1kWIbUTahGwgABR4haLYpIsMAAAAASUVORK5CYII=' },
  { id: 'asset-a16ddfcf-3020-4f11-b5e9-800474d3fd45', name: "爱芮_part_03.png", width: 26, height: 21, slice: { x: 35, y: 5 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAVCAYAAABYHP4bAAAAGUlEQVR4nGNgGAWjYBSMglEwCkbBKBhEAAAInQABzeqB1gAAAABJRU5ErkJggg==' },
  { id: 'asset-93906fb0-2479-4090-88c9-207d7a2b529f', name: "爱芮_part_14.png", width: 28, height: 23, slice: { x: 4, y: 85 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAXCAYAAAAYyi9XAAAAfUlEQVR4nGNgGAWjgETASIri/x8f/8dqCL8s0eYwUmIRORYzUcsyYtUyMdAZMFHLd8TqYWKgM2Aa9hayEKtQTscKzn505RhBcYp9qDglFWwgiCZGnGILZe0NGRgucEBoIsRxAYIlA6lZg5FAaUPQhySVk/zEqx0Fo4CBWAAAcVEvAnpFXe0AAAAASUVORK5CYII=' },
  { id: 'asset-421b21ba-11b7-4309-9e04-2c50f3d132e8', name: "知更鸟_part_01.png", width: 29, height: 22, slice: { x: 36, y: 117 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB0AAAAWCAYAAAA8VJfMAAAAcUlEQVR4nGNgGEqgqqrqP7l6majrlFGAChgZSAD/Pz7GGY+M/LJEm8VIqWXkWM5ETQuJVc/EMACAiZq+pIqltAJMNDN5WFsqp2NFf0sVp6QSlQCZ8EmSUsqAgKy94cCUSMQ4lomBCEBSuUpi6IyC4QEAsZ8ghPy31hUAAAAASUVORK5CYII=' },
  { id: 'asset-a97b5bf0-83af-4575-91bc-1e227def1590', name: "知更鸟_part_01.png", width: 25, height: 25, slice: { x: 69, y: 117 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAZCAYAAADE6YVjAAAAGUlEQVR4nO3BAQ0AAADCoPdPbQ8HFAAANwYJ3QABA5dj1QAAAABJRU5ErkJggg==' },
  { id: 'asset-90f00adb-e8f6-4f26-9ce1-cf3d0f738681', name: "爱芮_part_01.png", width: 12, height: 11, slice: { x: 62, y: 1 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAALCAYAAABLcGxfAAAAOElEQVR4nGNgwAH+f3z8H4QZ0AATLsXY2Fg1YDMVpwZsihn5ZRmxaiBGMU4/4FLMgEsDLsXDBQAAz70bg/fDgw8AAAAASUVORK5CYII=' },
  { id: 'asset-4e718531-cba8-43aa-a896-a4dfff1c0b96', name: "爱芮_part_02.png", width: 9, height: 10, slice: { x: 80, y: 1 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAAKCAYAAABmBXS+AAAAN0lEQVR4nGNgYGBg+P/x8X8QZsABmJAlcSlkQhfAppCJkV+WkZBCsEmEFMKtw6YQq5vwKaQjAACqwRuDATzQOQAAAABJRU5ErkJggg==' },
  { id: 'asset-7a4c09a6-745c-4f00-adb5-599480ed1976', name: "爱芮_part_09.png", width: 8, height: 14, slice: { x: 80, y: 31 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAOCAYAAAASVl2WAAAAKUlEQVR4nGNgIAAY/398/B9DkF+WEcZmImQC05BQwIjkJRq6gZA1lAEA8UUEckxkg0gAAAAASUVORK5CYII=' },
  { id: 'asset-aa171f6c-76da-45ce-867e-f677dd5b9ac8', name: "爱芮_part_08.png", width: 10, height: 15, slice: { x: 61, y: 31 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAPCAYAAADd/14OAAAAK0lEQVR4nGNgIBIwInP+f3z8H0MBvyxYDROxJjKNGIWM0KChs9XI1g4wAAAhjARykVZykQAAAABJRU5ErkJggg==' },
  { id: 'asset-8da09ce3-f4fd-488d-bc8f-8063ed79fcf3', name: "爱芮_part_13.png", width: 19, height: 11, slice: { x: 40, y: 71 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAALCAYAAACd1bY6AAAAMElEQVR4nGNkQAP/Pz7+z0AAMPLLMmITZ2KgImAi1VX41NHOZZQCJopNGHmGDV4AALq2C7aRK/1vAAAAAElFTkSuQmCC' },
  { id: 'asset-b0f4349e-962c-4859-924b-eed9e0c2f8a6', name: "爱芮_part_07.png", width: 8, height: 8, slice: { x: 80, y: 16 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAMklEQVR4nGP8//HxfwYoYOSXZYSxYYAJmYOsGKsCbIrARmLTCbMSbAI2uzGswKeIMgAAoWUQCzAB9YQAAAAASUVORK5CYII=' },
  { id: 'asset-9458f8f3-0ee7-4c08-854d-150b527eeaf3', name: "爱芮_part_06.png", width: 11, height: 12, slice: { x: 64, y: 16 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAsAAAAMCAYAAAC0qUeeAAAANklEQVR4nGNkQAP/Pz7+D2Mz8ssyIssx4VKIDTARqxAEGHEpYkRzAoYz8CnEqpgRh8JRwIAGAKo9EAs5Of/yAAAAAElFTkSuQmCC' },
  { id: 'asset-882b49dc-c3ff-4572-b911-7c8a506fb68c', name: "爱芮_part_12.png", width: 6, height: 12, slice: { x: 79, y: 48 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAAMCAYAAABBV8wuAAAAXUlEQVR4nGNkQAL/Pz7+D2MzMeAATNhUE6eDPIk3vzgwJUCChw4dYli35xSYzwKTAAnKysoyCAsLgyXhEiDBjo4OTKNAKtfOn8jwJt4A1RUgD9ptbPofFBT0H8QGALWoJqcyEtNnAAAAAElFTkSuQmCC' },
  { id: 'asset-f3327025-0d3b-425f-ab89-f839cc3ec2bf', name: "爱芮_part_11.png", width: 8, height: 14, slice: { x: 64, y: 48 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAOCAYAAAASVl2WAAAAZklEQVR4nGNkYGBg+P/x8X8GKGDkl2VkQAJMDAQAhoL/SKaRZwINFazbcwq3ApCkgYEBVoXgQAkKCoJ7raKigsHMzAweWCwwyTfxBgwHHRIZ7r35hWoHKGBAGKTQbmMTmE3I4aQBAMu5KoYbjoZZAAAAAElFTkSuQmCC' },
  { id: 'asset-e9b018aa-f239-4bb7-a2bc-4303c7b57e44', name: "知更鸟_part_01.png", width: 6, height: 6, slice: { x: 64, y: 64 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAAGCAYAAADgzO9IAAAADElEQVR4nGNgGIwAAACWAAGzNRKNAAAAAElFTkSuQmCC' },
  { id: 'asset-6c2a260c-3c46-4861-9953-bcdeb30b54ce', name: "爱芮_part_01.png", width: 13, height: 16, slice: { x: 107, y: 39 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA0AAAAQCAYAAADNo/U5AAAAEUlEQVR4nGNgGAWjYBRQCwAAA1AAAVGqIDgAAAAASUVORK5CYII=' },
  { id: 'asset-8eab41ed-0d59-47e9-b214-b40f04302358', name: "知更鸟_part_01.png", width: 8, height: 7, slice: { x: 79, y: 64 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAHCAYAAAA1WQxeAAAADElEQVR4nGNgGBEAAADnAAFoGQcWAAAAAElFTkSuQmCC' },
  { id: 'asset-9c35bb65-0d5f-432e-8515-2238cacf91c3', name: "知更鸟_part_01.png", width: 8, height: 8, slice: { x: 140, y: 44 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAADklEQVR4nGNgGAWgEAAAAQgAAaUERR4AAAAASUVORK5CYII=' },
  { id: 'asset-f7914ec4-5a7a-40e5-b723-da1d37155730', name: "知更鸟_part_01.png", width: 23, height: 49, slice: { x: 101, y: 64 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABcAAAAxCAYAAAAx3zKLAAAAG0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAC4MRHNAAGYvRhIAAAAAElFTkSuQmCC' },
  { id: 'asset-8320468e-5547-4bc3-a50d-aca029e575b6', name: "知更鸟_part_01.png", width: 17, height: 45, slice: { x: 136, y: 62 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAAtCAYAAABI1YAsAAAAGklEQVR4nO3BMQEAAADCoPVP7WENoAAAALoBDCEAAWchI0IAAAAASUVORK5CYII=' },
  { id: 'asset-5ea45371-82e3-42f8-9512-03386758e229', name: "爱芮_part_04.png", width: 23, height: 14, slice: { x: 101, y: 8 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABcAAAAOCAYAAADE84fzAAAAFElEQVR4nGNgGAWjYBSMglHAAAcABRYAAbbJE1sAAAAASUVORK5CYII=' },
  { id: 'asset-52bdefee-fda5-4034-8381-50a2b355a454', name: "知更鸟原_part_01.png", width: 21, height: 14, slice: { x: 134, y: 39 }, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAOCAYAAADABlfOAAAAEklEQVR4nGNgGAWjYBSMgsEMAASmAAHpmEeLAAAAAElFTkSuQmCC' },
];

const nodeStructure: Array<Pick<RigNode, 'id' | 'name' | 'parentId' | 'children' | 'assetIds' | 'sortingOrder' | 'pivot'>> = [
  {
    id: 'body',
    name: "Body",
    parentId: null,
    children: ['head', 'left-arm', 'right-arm'],
    assetIds: ['asset-5c16cd8f-d43c-4164-8c7c-a61fa4cd8b4a'],
    sortingOrder: 0,
    pivot: { x: 0, y: 7 },
  },
  {
    id: 'head',
    name: "Head",
    parentId: 'body',
    children: ['node-611a3118-f93c-4c25-9daf-1ae1942ad9e7', 'node-44a150a6-990d-4d7c-af69-39e38b7f459c', 'node-e7e6fb29-cf33-4386-8bfe-20e37fb1013b', 'node-d5ccff5b-31d5-411e-a25a-d4f7d1e4b011'],
    assetIds: ['asset-a16ddfcf-3020-4f11-b5e9-800474d3fd45', 'asset-93906fb0-2479-4090-88c9-207d7a2b529f', 'asset-421b21ba-11b7-4309-9e04-2c50f3d132e8', 'asset-a97b5bf0-83af-4575-91bc-1e227def1590'],
    sortingOrder: 0,
    pivot: { x: 14, y: 18 },
  },
  {
    id: 'left-arm',
    name: "Left Arm",
    parentId: 'body',
    children: ['node-17be1867-6181-4972-bf84-2a50efbd9c8d'],
    assetIds: ['asset-90f00adb-e8f6-4f26-9ce1-cf3d0f738681'],
    sortingOrder: 1,
    pivot: { x: 11, y: 3 },
  },
  {
    id: 'right-arm',
    name: "Right Arm",
    parentId: 'body',
    children: ['node-ccaf0f57-e651-4e06-9f0f-c5a3614d6687'],
    assetIds: ['asset-4e718531-cba8-43aa-a896-a4dfff1c0b96'],
    sortingOrder: -1,
    pivot: { x: 2, y: 2 },
  },
  {
    id: 'left-leg',
    name: "Left Leg",
    parentId: 'node-cee56c26-e690-4ec5-b681-2b2a151c9856',
    children: ['node-cc6d882b-6dd4-45f0-8e36-b00cf8ddef6c'],
    assetIds: ['asset-7a4c09a6-745c-4f00-adb5-599480ed1976'],
    sortingOrder: 0,
    pivot: { x: 2, y: 3 },
  },
  {
    id: 'right-leg',
    name: "Right Leg",
    parentId: 'node-cee56c26-e690-4ec5-b681-2b2a151c9856',
    children: ['node-b0d4040f-5331-436b-8399-18326f4423bc'],
    assetIds: ['asset-aa171f6c-76da-45ce-867e-f677dd5b9ac8'],
    sortingOrder: 0,
    pivot: { x: 6, y: 2 },
  },
  {
    id: 'node-cee56c26-e690-4ec5-b681-2b2a151c9856',
    name: "DownBody",
    parentId: null,
    children: ['right-leg', 'left-leg', 'node-5d1a0177-3b8b-428f-bb03-653f36ba3b62', 'node-2d6bf169-8b45-498e-b8f5-44fbea09cc6e'],
    assetIds: ['asset-8da09ce3-f4fd-488d-bc8f-8063ed79fcf3'],
    sortingOrder: 1,
    pivot: { x: 9, y: 5 },
  },
  {
    id: 'node-ccaf0f57-e651-4e06-9f0f-c5a3614d6687',
    name: "Right Rig",
    parentId: 'right-arm',
    children: ['node-27468513-8138-43d4-ae16-a4f0b3b07286'],
    assetIds: ['asset-b0f4349e-962c-4859-924b-eed9e0c2f8a6'],
    sortingOrder: 1,
    pivot: { x: 0, y: 0 },
  },
  {
    id: 'node-17be1867-6181-4972-bf84-2a50efbd9c8d',
    name: "Left Rig",
    parentId: 'left-arm',
    children: [],
    assetIds: ['asset-9458f8f3-0ee7-4c08-854d-150b527eeaf3'],
    sortingOrder: 1,
    pivot: { x: 7, y: 1 },
  },
  {
    id: 'node-cc6d882b-6dd4-45f0-8e36-b00cf8ddef6c',
    name: "New Child",
    parentId: 'left-leg',
    children: ['node-69c4fba8-0a8a-49d6-8b82-2e131150d19b'],
    assetIds: ['asset-882b49dc-c3ff-4572-b911-7c8a506fb68c'],
    sortingOrder: 0,
    pivot: { x: 0, y: 0 },
  },
  {
    id: 'node-b0d4040f-5331-436b-8399-18326f4423bc',
    name: "New Child",
    parentId: 'right-leg',
    children: ['node-ea1bcf9a-e3aa-4fed-8a59-a9b511941aa0'],
    assetIds: ['asset-f3327025-0d3b-425f-ab89-f839cc3ec2bf'],
    sortingOrder: 0,
    pivot: { x: 0, y: 0 },
  },
  {
    id: 'node-611a3118-f93c-4c25-9daf-1ae1942ad9e7',
    name: "HeadTail",
    parentId: 'head',
    children: [],
    assetIds: ['asset-e9b018aa-f239-4bb7-a2bc-4303c7b57e44', 'asset-6c2a260c-3c46-4861-9953-bcdeb30b54ce'],
    sortingOrder: -2,
    pivot: { x: 3, y: 3 },
  },
  {
    id: 'node-44a150a6-990d-4d7c-af69-39e38b7f459c',
    name: "HeadTail Copy",
    parentId: 'head',
    children: [],
    assetIds: ['asset-6c2a260c-3c46-4861-9953-bcdeb30b54ce'],
    sortingOrder: -2,
    pivot: { x: 5, y: 8 },
  },
  {
    id: 'node-69c4fba8-0a8a-49d6-8b82-2e131150d19b',
    name: "New Child",
    parentId: 'node-cc6d882b-6dd4-45f0-8e36-b00cf8ddef6c',
    children: [],
    assetIds: ['asset-e9b018aa-f239-4bb7-a2bc-4303c7b57e44'],
    sortingOrder: 0,
    pivot: { x: 3, y: 3 },
  },
  {
    id: 'node-ea1bcf9a-e3aa-4fed-8a59-a9b511941aa0',
    name: "New Child",
    parentId: 'node-b0d4040f-5331-436b-8399-18326f4423bc',
    children: [],
    assetIds: ['asset-8eab41ed-0d59-47e9-b214-b40f04302358', 'asset-e9b018aa-f239-4bb7-a2bc-4303c7b57e44'],
    sortingOrder: 0,
    pivot: { x: 3, y: 3 },
  },
  {
    id: 'node-5d1a0177-3b8b-428f-bb03-653f36ba3b62',
    name: "装饰1",
    parentId: 'node-cee56c26-e690-4ec5-b681-2b2a151c9856',
    children: [],
    assetIds: ['asset-9c35bb65-0d5f-432e-8515-2238cacf91c3'],
    sortingOrder: 1,
    pivot: { x: 4, y: 4 },
  },
  {
    id: 'node-e7e6fb29-cf33-4386-8bfe-20e37fb1013b',
    name: "头发后",
    parentId: 'head',
    children: [],
    assetIds: ['asset-f7914ec4-5a7a-40e5-b723-da1d37155730'],
    sortingOrder: -6,
    pivot: { x: 10, y: 7 },
  },
  {
    id: 'node-27468513-8138-43d4-ae16-a4f0b3b07286',
    name: "New Child",
    parentId: 'node-ccaf0f57-e651-4e06-9f0f-c5a3614d6687',
    children: [],
    assetIds: ['asset-8320468e-5547-4bc3-a50d-aca029e575b6'],
    sortingOrder: 0,
    pivot: { x: 8, y: 10 },
  },
  {
    id: 'node-2d6bf169-8b45-498e-b8f5-44fbea09cc6e',
    name: "New Child",
    parentId: 'node-cee56c26-e690-4ec5-b681-2b2a151c9856',
    children: [],
    assetIds: ['asset-5ea45371-82e3-42f8-9512-03386758e229'],
    sortingOrder: 0,
    pivot: { x: 11, y: 7 },
  },
  {
    id: 'node-d5ccff5b-31d5-411e-a25a-d4f7d1e4b011',
    name: "New Child",
    parentId: 'head',
    children: [],
    assetIds: ['asset-52bdefee-fda5-4034-8381-50a2b355a454'],
    sortingOrder: 0,
    pivot: { x: 10, y: 7 },
  },
];

const firstFrameStates: Record<string, NodeFrameState> = {
  'body': { position: { x: -12, y: 9 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 0 },
  'head': { position: { x: 6, y: -7 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 1, sortingOrder: 0 },
  'left-arm': { position: { x: 2, y: -3 }, rotation: -19, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 1 },
  'right-arm': { position: { x: 10.695677899350137, y: -3.2879490621297016 }, rotation: 20, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: -1 },
  'left-leg': { position: { x: -3, y: 3 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 0 },
  'right-leg': { position: { x: 4, y: 1 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 0 },
  'node-cee56c26-e690-4ec5-b681-2b2a151c9856': { position: { x: -6, y: 17 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 1 },
  'node-ccaf0f57-e651-4e06-9f0f-c5a3614d6687': { position: { x: 3, y: 4 }, rotation: -16, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 1 },
  'node-17be1867-6181-4972-bf84-2a50efbd9c8d': { position: { x: -5, y: 2 }, rotation: 18, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 1 },
  'node-cc6d882b-6dd4-45f0-8e36-b00cf8ddef6c': { position: { x: -3, y: 5 }, rotation: 7, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 0 },
  'node-b0d4040f-5331-436b-8399-18326f4423bc': { position: { x: -3, y: 8 }, rotation: -11, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 0 },
  'node-611a3118-f93c-4c25-9daf-1ae1942ad9e7': { position: { x: -9, y: -6 }, rotation: 0, scale: { x: -1, y: 1 }, visible: true, imageIndex: 1, sortingOrder: -2 },
  'node-44a150a6-990d-4d7c-af69-39e38b7f459c': { position: { x: 11, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: -2 },
  'node-69c4fba8-0a8a-49d6-8b82-2e131150d19b': { position: { x: 4, y: 11 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 0 },
  'node-ea1bcf9a-e3aa-4fed-8a59-a9b511941aa0': { position: { x: 1, y: 10 }, rotation: 6, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 0 },
  'node-5d1a0177-3b8b-428f-bb03-653f36ba3b62': { position: { x: -3, y: -1 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 1 },
  'node-e7e6fb29-cf33-4386-8bfe-20e37fb1013b': { position: { x: -2, y: -3 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: -6 },
  'node-27468513-8138-43d4-ae16-a4f0b3b07286': { position: { x: 5, y: -7 }, rotation: -4, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 0 },
  'node-2d6bf169-8b45-498e-b8f5-44fbea09cc6e': { position: { x: 1, y: 3 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: -6 },
  'node-d5ccff5b-31d5-411e-a25a-d4f7d1e4b011': { position: { x: -1, y: -21 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: -1 },
};

const settings: ProjectSettings = {
  canvasSize: { x: 320, y: 240 },
  gridSize: 8,
  pixelPerfectRotation: true,
  pixelGridSize: 1,
  rotationSnapAngle: 1,
};

const rootNodeIds: string[] = ['body', 'node-cee56c26-e690-4ec5-b681-2b2a151c9856'];

const folders = ['All sprites', 'Sprite Sheets', 'Unsorted'];

function cloneState(state: NodeFrameState): NodeFrameState {
  return { ...state, position: { ...state.position }, scale: { ...state.scale } };
}

export function createCharacterTemplateProject() {
  const assets: Record<string, SpriteAsset> = {
    'character-template-sheet': {
      id: sheetSource.id,
      name: sheetSource.name,
      folder: 'Sprite Sheets',
      src: sheetSource.src,
      width: sheetSource.width,
      height: sheetSource.height,
      source: sheetSource,
      slice: { x: 0, y: 0, width: sheetSource.width, height: sheetSource.height },
    },
  };
  for (const part of parts) {
    assets[part.id] = {
      id: part.id,
      name: part.name,
      folder: 'Unsorted',
      width: part.width,
      height: part.height,
      src: part.src,
      source: sheetSource,
      slice: { ...part.slice, width: part.width, height: part.height },
    };
  }

  const nodes: Record<string, RigNode> = {};
  for (const definition of nodeStructure) {
    const state = firstFrameStates[definition.id];
    nodes[definition.id] = {
      ...definition,
      children: [...definition.children],
      assetIds: [...definition.assetIds],
      pivot: { ...definition.pivot },
      transform: { position: { ...state.position }, rotation: state.rotation, scale: { ...state.scale } },
      visible: state.visible,
      defaultImageIndex: state.imageIndex,
      locked: false,
    };
  }

  const firstFrame: AnimationFrame = {
    id: 'frame-character-template',
    nodeStates: Object.fromEntries(
      Object.entries(firstFrameStates).map(([nodeId, state]) => [nodeId, cloneState(state)]),
    ),
  };

  return { assets, nodes, rootNodeIds, folders, settings, frames: [firstFrame] };
}
