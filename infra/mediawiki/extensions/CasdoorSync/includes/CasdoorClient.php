<?php
namespace MediaWiki\Extension\CasdoorSync;

use MediaWiki\MediaWikiServices;

class CasdoorClient {
    private string $baseUrl, $clientId, $clientSecret, $org;

    public function __construct() {
        $cfg = MediaWikiServices::getInstance()->getMainConfig();
        $this->baseUrl      = $cfg->get( 'CasdoorSyncBaseUrl' );
        $this->clientId     = $cfg->get( 'CasdoorSyncClientId' );
        $this->clientSecret = $cfg->get( 'CasdoorSyncClientSecret' );
        $this->org          = $cfg->get( 'CasdoorSyncOrg' );
    }

    private ?string $token = null;

    // One token per client: a full sync calls get-user once per linked account.
    private function getToken(): ?string {
        if ( $this->token !== null ) return $this->token;
        $ch = curl_init();
        curl_setopt_array( $ch, [
            CURLOPT_URL => "{$this->baseUrl}/api/login/oauth/access_token",
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query( [
                'grant_type'    => 'client_credentials',
                'client_id'     => $this->clientId,
                'client_secret' => $this->clientSecret,
            ] ),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ] );
        $data = json_decode( curl_exec( $ch ), true );
        curl_close( $ch );
        $this->token = $data['access_token'] ?? null;
        return $this->token;
    }

    public function getUserBySubject( string $subject ): ?array {
        $token = $this->getToken();
        if ( !$token ) return null;

        $ch = curl_init();
        curl_setopt_array( $ch, [
            CURLOPT_URL => "{$this->baseUrl}/api/get-user?userId={$subject}&owner={$this->org}",
            CURLOPT_HTTPHEADER => [ "Authorization: Bearer {$token}" ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ] );
        $resp = json_decode( curl_exec( $ch ), true );
        curl_close( $ch );
        return $resp['data'] ?? null;
    }
}
