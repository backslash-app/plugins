import { close } from "@backslash/api";
import { addFeedForm } from "../feeds.ts";

export default addFeedForm((title) => close(`Subscribed to ${title}`));
