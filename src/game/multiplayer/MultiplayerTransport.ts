import { MultiplayerService } from './MultiplayerService';
import { stopLanHost } from './LanMultiplayerManager';
import type {
  AuthoritativePlayerVitals,
  AuthoritativeProgressionState,
  BossEncounterState,
  ClientMessageType,
  ConnectionQuality,
  CoopObjectiveType,
  CoopQuestStateRecord,
  CreateRoomOptions,
  EnemyAttackPlayerPayload,
  EntitySyncBatchPayload,
  GameEventPayload,
  IMultiplayerService,
  ISocialFriendsAdapter,
  JoinRoomOptions,
  MultiplayerConnectOptions,
  MultiplayerConnectionState,
  MultiplayerFriend,
  MultiplayerGameStartInfo,
  MultiplayerInvite,
  MultiplayerRoomState,
  MultiplayerRoomSummary,
  MultiplayerServiceConfig,
  MultiplayerServiceEvent,
  MultiplayerTransportProtocol,
  PartyStateSnapshot,
  PlayerNetworkState,
  PlayerProfileSummary,
  PlayerReportReason,
  RoomChatMessage,
  RoomWorldSnapshotPayload,
  SendChatResult,
  SocialModerationEntry,
  WorldSettingsUpdatePayload,
} from './multiplayerTypes';

export type MultiplayerTransportMode = 'online' | 'lan';

/**
 * Transport wrapper implementing IMultiplayerService that cleanly switches between:
 *  - 'online': Cloudflare Workers + Durable Objects (unchanged)
 *  - 'lan': Local Wi-Fi HTTP + WebSocket server running on the host device (zero Internet)
 *
 * All downstream gameplay, HUD, chat, party, and lobby consumers remain 100% unchanged.
 */
export class SwitchingMultiplayerTransport implements IMultiplayerService {
  private readonly onlineService: IMultiplayerService;
  private lanService: MultiplayerService | null = null;
  private lanBaseUrl: string | null = null;
  private lanDisplayAddress: string | null = null;
  private activeMode: MultiplayerTransportMode = 'online';
  private activeUnsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<(event: MultiplayerServiceEvent) => void>();

  constructor(onlineService: IMultiplayerService) {
    this.onlineService = onlineService;
    this.bindActiveSubscription();
  }

  public get protocol(): MultiplayerTransportProtocol {
    return this.getActiveService().protocol;
  }

  public getActiveMode(): MultiplayerTransportMode {
    return this.activeMode;
  }

  public getLanBaseUrl(): string | null {
    return this.lanBaseUrl;
  }

  public setLanDisplayAddress(address: string | null): void {
    this.lanDisplayAddress = address ? address.trim() : null;
  }

  public getLanDisplayAddress(): string | null {
    if (this.lanDisplayAddress) return this.lanDisplayAddress;
    if (this.lanBaseUrl) return this.lanBaseUrl.replace(/^https?:\/\//i, '');
    return null;
  }

  public getOnlineService(): IMultiplayerService {
    return this.onlineService;
  }

  public getLanService(): MultiplayerService | null {
    return this.lanService;
  }

  public useOnlineMode(): void {
    if (this.activeMode === 'online') return;
    if (this.lanService) {
      try {
        this.lanService.disconnect();
      } catch {
        // Ignore cleanup errors
      }
      this.lanService = null;
      this.lanBaseUrl = null;
      this.lanDisplayAddress = null;
    }
    this.activeMode = 'online';
    this.bindActiveSubscription();
  }

  public useLanMode(baseUrl: string): void {
    const normalized = baseUrl.trim().replace(/\/+$/, '');
    if (
      this.activeMode === 'lan' &&
      this.lanService &&
      this.lanBaseUrl === normalized
    ) {
      return;
    }
    if (this.activeMode === 'online') {
      try {
        this.onlineService.stopInvitePolling();
        if (this.onlineService.getRoomState()) {
          this.onlineService.disconnect();
        }
      } catch {
        // Ignore cleanup errors
      }
    } else if (this.lanService) {
      try {
        this.lanService.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    }

    this.lanBaseUrl = normalized;
    this.lanService = new MultiplayerService(
      normalized,
      this.onlineService.getSocialAdapter(),
    );
    this.activeMode = 'lan';
    this.bindActiveSubscription();
  }

  private getActiveService(): IMultiplayerService {
    if (this.activeMode === 'lan' && this.lanService) {
      return this.lanService;
    }
    return this.onlineService;
  }

  private bindActiveSubscription(): void {
    if (this.activeUnsubscribe) {
      this.activeUnsubscribe();
      this.activeUnsubscribe = null;
    }
    const target = this.getActiveService();
    this.activeUnsubscribe = target.subscribe((event) => {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (err) {
          console.error('[MultiplayerTransport] Listener error:', err);
        }
      }
    });
  }

  public connect(target?: MultiplayerConnectOptions | string): Promise<void> {
    return this.getActiveService().connect(target);
  }

  public disconnect(): void {
    this.getActiveService().disconnect();
  }

  public retryReconnect(): Promise<void> {
    return this.getActiveService().retryReconnect();
  }

  public getReconnectAttempt(): number {
    return this.getActiveService().getReconnectAttempt();
  }

  public getMaxReconnectAttempts(): number {
    return this.getActiveService().getMaxReconnectAttempts();
  }

  public getConnectionState(): MultiplayerConnectionState {
    return this.getActiveService().getConnectionState();
  }

  public getLatencyMs(): number | null {
    return this.getActiveService().getLatencyMs();
  }

  public getConnectionQuality(): ConnectionQuality {
    return this.getActiveService().getConnectionQuality();
  }

  public getNetworkPacketsPerSec(): number {
    return this.getActiveService().getNetworkPacketsPerSec?.() ?? 0;
  }

  public setLowPowerMode(enabled: boolean): void {
    this.onlineService.setLowPowerMode?.(enabled);
    this.lanService?.setLowPowerMode?.(enabled);
  }

  public getLocalPlayerId(): string | null {
    return this.getActiveService().getLocalPlayerId();
  }

  public isConfigured(): boolean {
    return this.getActiveService().isConfigured();
  }

  public getConfig(): MultiplayerServiceConfig {
    return this.getActiveService().getConfig();
  }

  public getRoomState(): MultiplayerRoomState | null {
    return this.getActiveService().getRoomState();
  }

  public getCurrentRoom(): MultiplayerRoomState | null {
    return this.getActiveService().getCurrentRoom();
  }

  public getAuthoritativeGameStartInfo(): MultiplayerGameStartInfo | null {
    return this.getActiveService().getAuthoritativeGameStartInfo();
  }

  public getLatestWorldSnapshot(): RoomWorldSnapshotPayload | null {
    return this.getActiveService().getLatestWorldSnapshot?.() ?? null;
  }

  public getLatestProgression(): AuthoritativeProgressionState | null {
    return this.getActiveService().getLatestProgression?.() ?? null;
  }

  public getLatestVitals(): AuthoritativePlayerVitals | null {
    return this.getActiveService().getLatestVitals?.() ?? null;
  }

  public listPublicRooms(): Promise<MultiplayerRoomSummary[]> {
    return this.getActiveService().listPublicRooms();
  }

  public verifyRoom(roomCodeOrId: string): Promise<MultiplayerRoomSummary> {
    return this.getActiveService().verifyRoom(roomCodeOrId);
  }

  public createRoom(options: CreateRoomOptions): Promise<MultiplayerRoomState> {
    return this.getActiveService().createRoom(options);
  }

  public joinRoom(options: JoinRoomOptions): Promise<MultiplayerRoomState> {
    return this.getActiveService().joinRoom(options);
  }

  public quickJoin(playerName: string): Promise<MultiplayerRoomState> {
    return this.getActiveService().quickJoin(playerName);
  }

  public async leaveRoom(): Promise<void> {
    const wasLanHost =
      this.activeMode === 'lan' &&
      Boolean(
        this.getActiveService().getRoomState()?.hostId &&
          this.getActiveService().getRoomState()?.hostId ===
            this.getActiveService().getLocalPlayerId(),
      );
    await this.getActiveService().leaveRoom();
    if (this.activeMode === 'lan') {
      this.lanDisplayAddress = null;
    }
    if (wasLanHost) {
      // Allow ROOM_CLOSED WebSocket frame to flush to connected LAN guests before closing sockets
      await new Promise((resolve) => setTimeout(resolve, 120));
      await stopLanHost();
    }
  }

  public kickPlayer(targetPlayerId: string): Promise<void> {
    return this.getActiveService().kickPlayer(targetPlayerId);
  }

  public transferHost(targetPlayerId: string): Promise<void> {
    return this.getActiveService().transferHost(targetPlayerId);
  }

  public updateRoomSettings(settings: {
    requireAllReady?: boolean;
    friendlyFire?: boolean;
  }): Promise<void> {
    return this.getActiveService().updateRoomSettings(settings);
  }

  public async closeRoom(): Promise<void> {
    const isLan = this.activeMode === 'lan';
    try {
      await this.getActiveService().closeRoom();
    } finally {
      if (isLan) {
        await stopLanHost();
      }
    }
  }

  public sendMessage<T = unknown>(type: ClientMessageType, payload?: T): boolean {
    return this.getActiveService().sendMessage(type, payload);
  }

  public sendPlayerState(state: PlayerNetworkState, immediate?: boolean): boolean {
    return this.getActiveService().sendPlayerState(state, immediate);
  }

  public sendEntitySync(payload: EntitySyncBatchPayload): boolean {
    return this.getActiveService().sendEntitySync?.(payload) ?? false;
  }

  public sendWorldSettingsUpdate(payload: WorldSettingsUpdatePayload): boolean {
    return this.getActiveService().sendWorldSettingsUpdate?.(payload) ?? false;
  }

  public sendEnemyAttackPlayer(payload: EnemyAttackPlayerPayload): boolean {
    return this.getActiveService().sendEnemyAttackPlayer?.(payload) ?? false;
  }

  public sendRepairWeapons(costCoins: number): boolean {
    return this.getActiveService().sendRepairWeapons?.(costCoins) ?? false;
  }

  public sendGameEvent(
    event: string,
    data?: GameEventPayload['data'],
  ): boolean {
    return this.getActiveService().sendGameEvent(event, data);
  }

  public sendChatMessage(text: string): SendChatResult {
    return this.getActiveService().sendChatMessage(text);
  }

  public getChatMessages(): RoomChatMessage[] {
    return this.getActiveService().getChatMessages();
  }

  public reportPlayer(
    targetPlayerId: string,
    reason: PlayerReportReason,
    details?: string,
  ): boolean {
    return this.getActiveService().reportPlayer(targetPlayerId, reason, details);
  }

  public mutePlayer(playerId: string, displayName: string): SocialModerationEntry[] {
    return this.getActiveService().mutePlayer(playerId, displayName);
  }

  public unmutePlayer(playerId: string, displayName?: string): SocialModerationEntry[] {
    return this.getActiveService().unmutePlayer(playerId, displayName);
  }

  public isPlayerMuted(playerId: string, displayName?: string): boolean {
    return this.getActiveService().isPlayerMuted(playerId, displayName);
  }

  public getMutedPlayers(): SocialModerationEntry[] {
    return this.getActiveService().getMutedPlayers();
  }

  public blockPlayer(playerId: string, displayName: string): SocialModerationEntry[] {
    return this.getActiveService().blockPlayer(playerId, displayName);
  }

  public unblockPlayer(playerId: string, displayName?: string): SocialModerationEntry[] {
    return this.getActiveService().unblockPlayer(playerId, displayName);
  }

  public isPlayerBlocked(playerId: string, displayName?: string): boolean {
    return this.getActiveService().isPlayerBlocked(playerId, displayName);
  }

  public getBlockedPlayers(): SocialModerationEntry[] {
    return this.getActiveService().getBlockedPlayers();
  }

  public getPlayerProfileSummary(playerId: string): PlayerProfileSummary | null {
    return this.getActiveService().getPlayerProfileSummary(playerId);
  }

  public getSocialAdapter(): ISocialFriendsAdapter {
    return this.getActiveService().getSocialAdapter();
  }

  public setReady(ready: boolean): Promise<MultiplayerRoomState | null> {
    return this.getActiveService().setReady(ready);
  }

  public startGame(): Promise<void> {
    return this.getActiveService().startGame();
  }

  public startMatch(): Promise<void> {
    return this.getActiveService().startMatch();
  }

  public getFriends(): Promise<MultiplayerFriend[]> {
    return this.getActiveService().getFriends();
  }

  public addFriend(displayName: string): Promise<MultiplayerFriend[]> {
    return this.getActiveService().addFriend(displayName);
  }

  public removeFriend(friendId: string): Promise<MultiplayerFriend[]> {
    return this.getActiveService().removeFriend(friendId);
  }

  public sendInvite(
    targetPlayerName: string,
    toPublicProfileId?: string,
    partyId?: string,
  ): Promise<MultiplayerInvite> {
    return this.getActiveService().sendInvite(
      targetPlayerName,
      toPublicProfileId,
      partyId,
    );
  }

  public getInvites(playerName?: string): Promise<MultiplayerInvite[]> {
    return this.getActiveService().getInvites(playerName);
  }

  public acceptInvite(
    inviteId: string,
    playerName?: string,
  ): Promise<MultiplayerRoomState> {
    return this.getActiveService().acceptInvite(inviteId, playerName);
  }

  public declineInvite(inviteId: string): Promise<void> {
    return this.getActiveService().declineInvite(inviteId);
  }

  public startInvitePolling(playerName: string): void {
    if (this.activeMode === 'online') {
      this.onlineService.startInvitePolling(playerName);
    }
  }

  public stopInvitePolling(): void {
    this.onlineService.stopInvitePolling();
  }

  public getPartyState(): PartyStateSnapshot {
    return (
      this.getActiveService().getPartyState?.() ?? {
        party: null,
        pendingInvites: [],
        outgoingInvites: [],
      }
    );
  }

  public createParty(): boolean {
    return this.getActiveService().createParty?.() ?? false;
  }

  public inviteToParty(target: {
    targetPlayerId?: string;
    targetPublicProfileId?: string;
    targetPlayerName?: string;
  }): boolean {
    return this.getActiveService().inviteToParty?.(target) ?? false;
  }

  public acceptPartyInvite(inviteId: string): boolean {
    return this.getActiveService().acceptPartyInvite?.(inviteId) ?? false;
  }

  public declinePartyInvite(inviteId: string): boolean {
    return this.getActiveService().declinePartyInvite?.(inviteId) ?? false;
  }

  public leaveParty(): boolean {
    return this.getActiveService().leaveParty?.() ?? false;
  }

  public removePartyMember(targetPlayerId: string): boolean {
    return this.getActiveService().removePartyMember?.(targetPlayerId) ?? false;
  }

  public transferPartyLeader(targetPlayerId: string): boolean {
    return this.getActiveService().transferPartyLeader?.(targetPlayerId) ?? false;
  }

  public setPartyReady(ready: boolean): boolean {
    return this.getActiveService().setPartyReady?.(ready) ?? false;
  }

  public startCoopObjective(options: {
    type: CoopObjectiveType;
    title?: string;
    targetId?: string;
    targetX?: number;
    targetZ?: number;
    targetCount?: number;
  }): boolean {
    return this.getActiveService().startCoopObjective?.(options) ?? false;
  }

  public cancelCoopObjective(): boolean {
    return this.getActiveService().cancelCoopObjective?.() ?? false;
  }

  public sendCoopObjectiveProgress(objectiveId: string, amount?: number): boolean {
    return (
      this.getActiveService().sendCoopObjectiveProgress?.(objectiveId, amount) ??
      false
    );
  }

  public getCoopQuests(): CoopQuestStateRecord[] {
    return this.getActiveService().getCoopQuests?.() ?? [];
  }

  public getBossEncounters(): BossEncounterState[] {
    return this.getActiveService().getBossEncounters?.() ?? [];
  }

  public startCoopQuest(questId: string): boolean {
    return this.getActiveService().startCoopQuest?.(questId) ?? false;
  }

  public completeCoopQuest(questId: string): boolean {
    return this.getActiveService().completeCoopQuest?.(questId) ?? false;
  }

  public sendNpcDialogueState(npcId: string, state: 'talking' | 'idle'): boolean {
    return this.getActiveService().sendNpcDialogueState?.(npcId, state) ?? false;
  }

  public sendPlayerBuildPlace(payload: {
    structureId: string;
    blueprintId: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    ownerName: string;
    permissionScope: 'owner' | 'friends' | 'party' | 'everyone';
  }): boolean {
    return this.getActiveService().sendPlayerBuildPlace?.(payload) ?? false;
  }

  public sendPlayerBuildRepair(structureId: string): boolean {
    return this.getActiveService().sendPlayerBuildRepair?.(structureId) ?? false;
  }

  public sendPlayerBuildUpgrade(structureId: string): boolean {
    return this.getActiveService().sendPlayerBuildUpgrade?.(structureId) ?? false;
  }

  public sendPlayerBuildDemolish(structureId: string): boolean {
    return this.getActiveService().sendPlayerBuildDemolish?.(structureId) ?? false;
  }

  public sendPlayerBuildPerms(
    structureId: string,
    permissionScope: 'owner' | 'friends' | 'party' | 'everyone',
  ): boolean {
    return (
      this.getActiveService().sendPlayerBuildPerms?.(structureId, permissionScope) ??
      false
    );
  }

  public sendPlayerStorageTransfer(
    structureId: string,
    direction: 'deposit' | 'withdraw',
    itemId: string,
    count: number,
  ): boolean {
    return (
      this.getActiveService().sendPlayerStorageTransfer?.(
        structureId,
        direction,
        itemId,
        count,
      ) ?? false
    );
  }

  public sendPlayerFarmTill(structureId: string): boolean {
    return this.getActiveService().sendPlayerFarmTill?.(structureId) ?? false;
  }

  public sendPlayerFarmPlant(structureId: string, cropId: string): boolean {
    return this.getActiveService().sendPlayerFarmPlant?.(structureId, cropId) ?? false;
  }

  public sendPlayerFarmWater(structureId: string): boolean {
    return this.getActiveService().sendPlayerFarmWater?.(structureId) ?? false;
  }

  public sendPlayerFarmHarvest(
    structureId: string,
    cropId?: string,
    villageId?: string,
  ): boolean {
    return (
      this.getActiveService().sendPlayerFarmHarvest?.(
        structureId,
        cropId,
        villageId,
      ) ?? false
    );
  }

  public sendVillageRepair(villageId: string, repairId: string): boolean {
    return this.getActiveService().sendVillageRepair?.(villageId, repairId) ?? false;
  }

  public sendVillageProject(villageId: string, projectId: string): boolean {
    return this.getActiveService().sendVillageProject?.(villageId, projectId) ?? false;
  }

  public sendVillageDefenseWon(villageId: string): boolean {
    return this.getActiveService().sendVillageDefenseWon?.(villageId) ?? false;
  }

  public sendMerchantBuy(villageId: string, offerId: string): boolean {
    return this.getActiveService().sendMerchantBuy?.(villageId, offerId) ?? false;
  }

  public sendMerchantSell(
    villageId: string,
    itemId: string,
    count: number,
  ): boolean {
    return (
      this.getActiveService().sendMerchantSell?.(villageId, itemId, count) ?? false
    );
  }

  public subscribe(listener: (event: MultiplayerServiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function isSwitchingMultiplayerTransport(
  service: IMultiplayerService | null | undefined,
): service is SwitchingMultiplayerTransport {
  return service instanceof SwitchingMultiplayerTransport;
}
