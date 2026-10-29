<?php
namespace MediaWiki\Extension\CasdoorSync;

use Job;
use MediaWiki\MediaWikiServices;
use MediaWiki\RenameUser\RenameuserSQL;
use MediaWiki\User\User;
use MediaWiki\Block\DatabaseBlock;

class CasdoorSyncJob extends Job {
    private const VALID_ROLES = ['member', 'pilot', 'elementlead', 'flightlead', 'squadronlead', 'admin'];

    public function __construct( $title, $params ) {
        parent::__construct( 'casdoorSync', $title, $params );
    }

    public function run(): bool {
        $client = new CasdoorClient();

        if ( $this->params['mode'] === 'single' ) {
            $casdoorUser = $client->getUserBySubject( $this->params['subject'] );
            if ( !$casdoorUser ) return true; // Casdoor unreachable; nightly full job will catch it
            $user = MediaWikiServices::getInstance()->getUserFactory()->newFromId( $this->params['userId'] );
            $user->load();
            $this->syncOne( $user, $casdoorUser );
            return true;
        }

        // mode === 'full': reconcile every linked wiki account against Casdoor.
        // Each account is fetched with get-user: Casdoor's get-users list returns
        // users without their roles, and syncing from it strips every group.
        $dbr = wfGetDB( DB_REPLICA );
        $userFactory = MediaWikiServices::getInstance()->getUserFactory();

        $rows = $dbr->select( 'openid_connect', ['oidc_user', 'oidc_subject'], [], __METHOD__ );
        foreach ( $rows as $row ) {
            if ( !$row->oidc_subject ) continue;
            $casdoorUser = $client->getUserBySubject( $row->oidc_subject );
            if ( !$casdoorUser ) continue; // unknown to Casdoor, or Casdoor unreachable: leave as is

            $user = $userFactory->newFromId( $row->oidc_user );
            $user->load();
            $this->syncOne( $user, $casdoorUser );
        }
        return true;
    }

    private function syncOne( User $user, array $casdoorUser ): void {
        $this->syncName( $user, $casdoorUser );
        $this->syncRoles( $user, $casdoorUser );
    }

    private function syncName( User $user, array $casdoorUser ): void {
        $casdoorName = $casdoorUser['name'] ?? null;
        if ( !$casdoorName ) return;

        $services = MediaWikiServices::getInstance();
        $wanted = $services->getUserNameUtils()->getCanonical( $casdoorName );
        if ( $wanted === null || $wanted === $user->getName() ) return;

        $existing = $services->getUserIdentityLookup()->getUserIdentityByName( $wanted );
        if ( $existing && $existing->isRegistered() ) return; // name collision, skip

        ( new RenameuserSQL(
            $user->getName(), $wanted, $user->getId(),
            User::newSystemUser( 'CasdoorSync', [ 'steal' => true ] ),
            [ 'reason' => 'Synced from Casdoor' ]
        ) )->rename();
    }

    private function syncRoles( User $user, array $casdoorUser ): void {
        $roles = $casdoorUser['roles'] ?? [];
        $wanted = [];
        foreach ( $roles as $r ) {
            $name = is_array( $r ) ? ( $r['name'] ?? '' ) : $r;
            if ( in_array( $name, self::VALID_ROLES, true ) ) $wanted[] = $name;
        }

        $ugm = MediaWikiServices::getInstance()->getUserGroupManager();
        foreach ( self::VALID_ROLES as $role ) {
            $has = in_array( $role, $ugm->getUserGroups( $user ), true );
            $want = in_array( $role, $wanted, true );
            if ( $has && !$want ) $ugm->removeUserFromGroup( $user, $role );
            if ( !$has && $want ) $ugm->addUserToGroup( $user, $role );
        }

        $forbidden = ( $casdoorUser['isForbidden'] ?? false ) || ( $casdoorUser['isDeleted'] ?? false );
        $this->syncBlock( $user, $forbidden );
    }

    private function syncBlock( User $user, bool $shouldBeBlocked ): void {
        $services = MediaWikiServices::getInstance();
        $blockStore = $services->getDatabaseBlockStore();
        $existing = $services->getBlockManager()->getUserBlock( $user, null, false );

        if ( $shouldBeBlocked && !$existing ) {
            $blockStore->insertBlock( new DatabaseBlock( [
                'address' => $user,
                'by'      => User::newSystemUser( 'CasdoorSync', [ 'steal' => true ] ),
                'reason'  => 'Disabled in Casdoor',
                'expiry'  => 'infinity',
            ] ) );
        } elseif ( !$shouldBeBlocked && $existing ) {
            $blockStore->deleteBlock( $existing );
        }
    }
}
