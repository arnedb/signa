// Route components that read params/search, kept in the lazily loaded admin chunk.
import { getRouteApi } from "@tanstack/react-router";

import { GroupPage } from "@/pages/admin/Groups";
import { RecordingPage } from "@/pages/admin/Recordings";
import { WordEditPage } from "@/pages/admin/WordEdit";
import { AdminWordsPage } from "@/pages/admin/Words";

const wordsApi = getRouteApi("/admin/");
const wordApi = getRouteApi("/admin/words/$wordId");
const recordingApi = getRouteApi("/admin/recordings/$recordingId");
const groupApi = getRouteApi("/admin/groups/$groupId");

export function AdminWords() {
  return <AdminWordsPage search={wordsApi.useSearch()} />;
}

export function AdminWord() {
  const { wordId } = wordApi.useParams();
  return <WordEditPage key={wordId} wordId={Number(wordId)} />;
}

export function AdminRecording() {
  const { recordingId } = recordingApi.useParams();
  return <RecordingPage key={recordingId} recordingId={Number(recordingId)} />;
}

export function AdminGroup() {
  const { groupId } = groupApi.useParams();
  return <GroupPage key={groupId} groupId={Number(groupId)} />;
}
